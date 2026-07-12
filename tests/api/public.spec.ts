import { describe, expect, it } from 'vitest';
import { TicketStatus, TicketVisibility } from '~/shared/types/ticket';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockCookie,
	mockQuery,
	seedAgent,
	seedCustomer,
	seedTicket
} from './route-runtime';

async function statusToken(env: any, id: number): Promise<string> {
	const utils = await import('#server-utils');
	return utils.hmacSha256(env.HMAC_SECRET, `status:${id}`);
}

// sha-256 hex, matching how customer session tokens are hashed for the kv lookup
async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

describe('POST /api/public/tickets', () => {
	it('creates a customer and ticket and returns a status token', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/public/tickets.post');

		mockBody({
			email: 'walkin@example.com',
			name: 'Walk In',
			title: 'Cannot log in',
			description: 'my password reset is broken'
		});
		const result = (await handler(eventFor(runtime.env))) as {
			ticket_id: number;
			status_token: string;
		};
		expect(typeof result.ticket_id).toBe('number');
		expect(typeof result.status_token).toBe('string');
		expect(result.status_token.length).toBeGreaterThan(0);

		const utils = await import('#server-utils');
		const customer = await utils.getCustomerByEmail('walkin@example.com', runtime.env);
		expect(customer?.name).toBe('Walk In');
	});

	it('creates a guest ticket with no email and still returns a token', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/public/tickets.post');

		mockBody({ title: 'Anonymous request', description: 'no email provided' });
		const result = (await handler(eventFor(runtime.env))) as {
			ticket_id: number;
			status_token: string;
		};
		expect(typeof result.ticket_id).toBe('number');
		expect(result.status_token.length).toBeGreaterThan(0);

		// the guest customer is created with an empty email (no thread to key against)
		const utils = await import('#server-utils');
		const thread = await utils.getTicketThread(result.ticket_id, runtime.env, null, {
			bypassGate: true
		});
		const guest = await utils.getCustomerById(thread.ticket.customer_id, runtime.env);
		expect(guest?.email).toBe('');
	});
});

describe('POST /api/public/reply', () => {
	it('appends a customer message for a valid token', async () => {
		const runtime = getRuntime();
		const create = await importRoute('~/server/api/public/tickets.post');
		mockBody({ email: 'reply@example.com', title: 'Need help', description: 'the details' });
		const created = (await create(eventFor(runtime.env))) as {
			ticket_id: number;
			status_token: string;
		};

		const handler = await importRoute('~/server/api/public/reply.post');
		mockBody({ id: created.ticket_id, token: created.status_token, message: 'here is more info' });
		const result = (await handler(eventFor(runtime.env))) as {
			sender_kind: string;
			message: string;
		};
		expect(result.sender_kind).toBe('customer');
		expect(result.message).toBe('here is more info');

		const utils = await import('#server-utils');
		const thread = await utils.getTicketThread(created.ticket_id, runtime.env, null, {
			bypassGate: true
		});
		const last = thread.messages[thread.messages.length - 1];
		expect(last?.message).toBe('here is more info');
		expect(last?.sender.kind).toBe('customer');
	});

	it('rejects a wrong token with 403', async () => {
		const runtime = getRuntime();
		const create = await importRoute('~/server/api/public/tickets.post');
		mockBody({ email: 'reply2@example.com', title: 'X', description: 'Y' });
		const created = (await create(eventFor(runtime.env))) as { ticket_id: number };

		const handler = await importRoute('~/server/api/public/reply.post');
		mockBody({ id: created.ticket_id, token: 'not-the-real-token', message: 'hi' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 403 });
	});

	it('hides a staff-internal ticket as a 404 even with a valid token', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Priv', email: 'priv2@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Secret',
			description: 'internal',
			customer_id: customer.id,
			visibility: TicketVisibility.Internal
		});

		const utils = await import('#server-utils');
		const token = await utils.hmacSha256(runtime.env.HMAC_SECRET, `status:${ticket.id}`);

		const handler = await importRoute('~/server/api/public/reply.post');
		mockBody({ id: ticket.id, token, message: 'let me in' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 404 });
	});

	it('accepts a token reply when the ticket has a real registered customer', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Reg', email: 'reg@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Real',
			description: 'has a registered customer',
			customer_id: customer.id,
			visibility: TicketVisibility.Public
		});

		const handler = await importRoute('~/server/api/public/reply.post');
		mockBody({
			id: ticket.id,
			token: await statusToken(runtime.env, ticket.id),
			message: 'a customer reply'
		});
		const result = (await handler(eventFor(runtime.env))) as {
			sender_kind: string;
			message: string;
		};
		expect(result.sender_kind).toBe('customer');
		expect(result.message).toBe('a customer reply');

		const utils = await import('#server-utils');
		const thread = await utils.getTicketThread(ticket.id, runtime.env, null, { bypassGate: true });
		expect(thread.messages[thread.messages.length - 1]?.message).toBe('a customer reply');
	});

	it('rejects a token reply to a guest (customer-less) ticket with 403', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		// customer_id defaults to 0 (no registered customer to reply as)
		const ticket = await utils.createTicket(
			{ title: 'Guest', description: 'no customer', visibility: TicketVisibility.Public },
			runtime.env
		);
		expect(ticket.customer_id).toBe(0);

		const handler = await importRoute('~/server/api/public/reply.post');
		mockBody({
			id: ticket.id,
			token: await statusToken(runtime.env, ticket.id),
			message: 'let me in as nobody'
		});
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 403 });
	});

	it('lets an owning customer session reply without a token', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Sess', email: 'sess@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Owned',
			description: 'reachable via a session',
			customer_id: customer.id,
			visibility: TicketVisibility.Public
		});

		// seed a customer session the way createCustomerSession would, then present its cookie
		const token = 'session-token-abc';
		const hash = await sha256Hex(token);
		await runtime.hubKv.set(`smoke:customer_session_user:${hash}`, String(customer.id));
		await runtime.hubKv.set(`smoke:customer_session_hash:${customer.id}:${hash}`, '1');
		mockCookie(token);

		try {
			const handler = await importRoute('~/server/api/public/reply.post');
			mockBody({ id: ticket.id, message: 'from my session' });
			const result = (await handler(eventFor(runtime.env))) as {
				sender_kind: string;
				message: string;
			};
			expect(result.sender_kind).toBe('customer');
			expect(result.message).toBe('from my session');
		} finally {
			// restore the default no-session cookie for the rest of the suite
			mockCookie(null);
		}
	});
});

describe('POST /api/public/reopen', () => {
	it('reopens a ticket that has a real registered customer via its token', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Reo', email: 'reo@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Closed request',
			description: 'want it back open',
			customer_id: customer.id,
			status: TicketStatus.Closed,
			visibility: TicketVisibility.Public
		});

		const handler = await importRoute('~/server/api/public/reopen.post');
		mockBody({ id: ticket.id, token: await statusToken(runtime.env, ticket.id) });
		const result = (await handler(eventFor(runtime.env))) as { id: number; status: string };
		expect(result.status).toBe(TicketStatus.Open);
	});

	it('rejects a token reopen to a customer-less ticket with 403', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		// customer_id defaults to 0 (agent-created, no registered customer to reply to)
		const ticket = await utils.createTicket(
			{ title: 'Agent only', description: 'no customer', visibility: TicketVisibility.Public },
			runtime.env
		);
		expect(ticket.customer_id).toBe(0);

		const handler = await importRoute('~/server/api/public/reopen.post');
		mockBody({ id: ticket.id, token: await statusToken(runtime.env, ticket.id) });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 403 });
	});

	it('rejects a wrong token with 403', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Reo2', email: 'reo2@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Closed',
			description: 'x',
			customer_id: customer.id,
			status: TicketStatus.Closed,
			visibility: TicketVisibility.Public
		});

		const handler = await importRoute('~/server/api/public/reopen.post');
		mockBody({ id: ticket.id, token: 'not-the-real-token' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 403 });
	});

	it('lets an owning customer session reopen without a token', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Sess', email: 'sess-reo@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Owned closed',
			description: 'reopen via session',
			customer_id: customer.id,
			status: TicketStatus.Closed,
			visibility: TicketVisibility.Public
		});

		const token = 'session-token-reopen';
		const hash = await sha256Hex(token);
		await runtime.hubKv.set(`smoke:customer_session_user:${hash}`, String(customer.id));
		await runtime.hubKv.set(`smoke:customer_session_hash:${customer.id}:${hash}`, '1');
		mockCookie(token);

		try {
			const handler = await importRoute('~/server/api/public/reopen.post');
			mockBody({ id: ticket.id });
			const result = (await handler(eventFor(runtime.env))) as { id: number; status: string };
			expect(result.status).toBe(TicketStatus.Open);
		} finally {
			mockCookie(null);
		}
	});
});

describe('turnstile verification', () => {
	// the default harness has no useRuntimeConfig global, so turnstile reads as unconfigured
	function withTurnstileConfig(config: unknown, verify?: (...args: any[]) => unknown): () => void {
		const g = globalThis as Record<string, unknown>;
		const hadConfig = 'useRuntimeConfig' in g;
		const hadVerify = 'verifyTurnstileToken' in g;
		const prevConfig = g.useRuntimeConfig;
		const prevVerify = g.verifyTurnstileToken;
		g.useRuntimeConfig = () => config;
		if (verify) g.verifyTurnstileToken = verify;
		return () => {
			if (hadConfig) g.useRuntimeConfig = prevConfig;
			else delete g.useRuntimeConfig;
			if (verify) {
				if (hadVerify) g.verifyTurnstileToken = prevVerify;
				else delete g.verifyTurnstileToken;
			}
		};
	}

	const configured = {
		turnstile: { secretKey: 'real-secret' },
		public: { turnstile: { siteKey: 'site-key' } }
	};

	it('isTurnstileConfigured is false when unconfigured and true when both keys set', async () => {
		const utils = await import('#server-utils');
		const event = eventFor(getRuntime().env);
		// unconfigured (no useRuntimeConfig global in the harness)
		expect(utils.isTurnstileConfigured(event)).toBe(false);

		const restore = withTurnstileConfig(configured);
		try {
			expect(utils.isTurnstileConfigured(event)).toBe(true);
		} finally {
			restore();
		}
	});

	it('is a no-op (resolves) when turnstile is unconfigured, even with no token', async () => {
		const utils = await import('#server-utils');
		const event = eventFor(getRuntime().env);
		await expect(utils.verifyTurnstile(event, undefined)).resolves.toBeUndefined();
	});

	it('requires a token (400) when configured but none is supplied', async () => {
		const utils = await import('#server-utils');
		const event = eventFor(getRuntime().env);
		const restore = withTurnstileConfig(configured);
		try {
			await expect(utils.verifyTurnstile(event, undefined)).rejects.toMatchObject({
				statusCode: 400
			});
		} finally {
			restore();
		}
	});

	it('throws 403 when the siteverify call reports failure', async () => {
		const utils = await import('#server-utils');
		const event = eventFor(getRuntime().env);
		const restore = withTurnstileConfig(configured, async () => ({ success: false }));
		try {
			await expect(utils.verifyTurnstile(event, 'a-token')).rejects.toMatchObject({
				statusCode: 403
			});
		} finally {
			restore();
		}
	});

	it('resolves when the siteverify call reports success', async () => {
		const utils = await import('#server-utils');
		const event = eventFor(getRuntime().env);
		const restore = withTurnstileConfig(configured, async () => ({ success: true }));
		try {
			await expect(utils.verifyTurnstile(event, 'a-token')).resolves.toBeUndefined();
		} finally {
			restore();
		}
	});

	it('fails closed (403) when the siteverify call throws (outage)', async () => {
		const utils = await import('#server-utils');
		const event = eventFor(getRuntime().env);
		const restore = withTurnstileConfig(configured, async () => {
			throw new Error('network down');
		});
		try {
			await expect(utils.verifyTurnstile(event, 'a-token')).rejects.toMatchObject({
				statusCode: 403
			});
		} finally {
			restore();
		}
	});

	it('short-circuits the always-pass test secret key without a network call', async () => {
		const utils = await import('#server-utils');
		const event = eventFor(getRuntime().env);
		const restore = withTurnstileConfig(
			{
				turnstile: { secretKey: '1x0000000000000000000000000000000AA' },
				public: { turnstile: { siteKey: 'site-key' } }
			},
			async () => {
				throw new Error('should not be called');
			}
		);
		try {
			await expect(utils.verifyTurnstile(event, 'any-token')).resolves.toBeUndefined();
		} finally {
			restore();
		}
	});

	it('short-circuits the always-fail test secret key to 403 without a network call', async () => {
		const utils = await import('#server-utils');
		const event = eventFor(getRuntime().env);
		const restore = withTurnstileConfig(
			{
				turnstile: { secretKey: '2x0000000000000000000000000000000AA' },
				public: { turnstile: { siteKey: 'site-key' } }
			},
			async () => {
				throw new Error('should not be called');
			}
		);
		try {
			await expect(utils.verifyTurnstile(event, 'any-token')).rejects.toMatchObject({
				statusCode: 403
			});
		} finally {
			restore();
		}
	});

	it('enforces the token on a public endpoint when turnstile is configured', async () => {
		const runtime = getRuntime();
		const restore = withTurnstileConfig(configured, async () => ({ success: false }));
		try {
			const handler = await importRoute('~/server/api/public/tickets.post');
			mockBody({ title: 'No captcha', description: 'should be blocked' });
			await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });
		} finally {
			restore();
		}
	});
});

describe('GET /api/public/status', () => {
	it('returns public ticket fields for a valid token', async () => {
		const runtime = getRuntime();
		const create = await importRoute('~/server/api/public/tickets.post');
		mockBody({ email: 'status@example.com', title: 'Broken', description: 'details here' });
		const created = (await create(eventFor(runtime.env))) as {
			ticket_id: number;
			status_token: string;
		};

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: created.ticket_id, token: created.status_token });
		const result = (await handler(eventFor(runtime.env))) as any;
		expect(result.id).toBe(created.ticket_id);
		expect(result.title).toBe('Broken');
		expect(result.status).toBeDefined();
		expect(result.priority).toBeDefined();
		expect(Array.isArray(result.messages)).toBe(true);
	});

	it('rejects a wrong token with 403', async () => {
		const runtime = getRuntime();
		const create = await importRoute('~/server/api/public/tickets.post');
		mockBody({ email: 'wrong@example.com', title: 'Broken', description: 'details' });
		const created = (await create(eventFor(runtime.env))) as { ticket_id: number };

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: created.ticket_id, token: 'not-the-real-token' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 403 });
	});

	it('hides a staff-internal ticket as a 404 even with a valid token', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Priv', email: 'priv@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Secret',
			description: 'internal',
			customer_id: customer.id,
			visibility: TicketVisibility.Internal
		});

		const utils = await import('#server-utils');
		const token = await utils.hmacSha256(runtime.env.HMAC_SECRET, `status:${ticket.id}`);

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: ticket.id, token });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 404 });
	});

	it('lets the submitter view an unlisted private ticket via its token', async () => {
		const runtime = getRuntime();
		const create = await importRoute('~/server/api/public/tickets.post');
		// guest submissions default to private (not public-searchable) but stay token-viewable
		mockBody({ email: 'priv-guest@example.com', title: 'Mine', description: 'only via token' });
		const created = (await create(eventFor(runtime.env))) as {
			ticket_id: number;
			status_token: string;
		};

		const utils = await import('#server-utils');
		const t = await utils.getTicketThread(created.ticket_id, runtime.env, null, {
			bypassGate: true
		});
		expect(t.ticket.visibility).toBe('private');

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: created.ticket_id, token: created.status_token });
		const result = (await handler(eventFor(runtime.env))) as any;
		expect(result.id).toBe(created.ticket_id);
		expect(result.title).toBe('Mine');
	});
});

describe('ticket participant portal + public access', () => {
	async function seedSession(runtime: any, customerId: number, token: string) {
		const hash = await sha256Hex(token);
		await runtime.hubKv.set(`smoke:customer_session_user:${hash}`, String(customerId));
		await runtime.hubKv.set(`smoke:customer_session_hash:${customerId}:${hash}`, '1');
	}

	it('listTicketsByCustomer unions participant tickets with owned (excludes internal)', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const owner = await seedCustomer(runtime, { name: 'Owner', email: 'p-owner@example.com' });
		const ownedTicket = await seedTicket(runtime, {
			title: 'Owned',
			description: 'x',
			customer_id: owner.id,
			visibility: TicketVisibility.Public
		});

		const other = await seedCustomer(runtime, { name: 'Other', email: 'p-other@example.com' });
		const sharedTicket = await seedTicket(runtime, {
			title: 'Shared private',
			description: 'y',
			customer_id: other.id,
			visibility: TicketVisibility.Private
		});
		const internalTicket = await seedTicket(runtime, {
			title: 'Shared internal',
			description: 'z',
			customer_id: other.id,
			visibility: TicketVisibility.Internal
		});
		await utils.addTicketParticipant(sharedTicket.id, 'p-cc@example.com', runtime.env);
		await utils.addTicketParticipant(internalTicket.id, 'p-cc@example.com', runtime.env);

		const cc = await utils.getCustomerByEmail('p-cc@example.com', runtime.env);
		const list = await utils.listTicketsByCustomer(cc!.id, runtime.env);
		const ids = list.map((t: any) => t.id);
		expect(ids).toContain(sharedTicket.id);
		// participant sees a private ticket but never an internal one, and never a stranger's owned ticket
		expect(ids).not.toContain(internalTicket.id);
		expect(ids).not.toContain(ownedTicket.id);
	});

	it('status.get authorizes a participant session without a token', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const owner = await seedCustomer(runtime, { name: 'Owner', email: 's-owner@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Private shared',
			description: 'secret',
			customer_id: owner.id,
			visibility: TicketVisibility.Private
		});
		await utils.addTicketParticipant(ticket.id, 's-cc@example.com', runtime.env);
		const cc = await utils.getCustomerByEmail('s-cc@example.com', runtime.env);

		const token = 'sess-participant-status';
		await seedSession(runtime, cc!.id, token);
		mockCookie(token);
		try {
			const handler = await importRoute('~/server/api/public/status.get');
			mockQuery({ id: ticket.id });
			const result = (await handler(eventFor(runtime.env))) as any;
			expect(result.id).toBe(ticket.id);
			expect(result.title).toBe('Private shared');
		} finally {
			mockCookie(null);
		}
	});

	it('status.get denies a non-participant session without a token (403)', async () => {
		const runtime = getRuntime();
		const owner = await seedCustomer(runtime, { name: 'Owner', email: 's-owner2@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Not yours',
			description: 'secret',
			customer_id: owner.id,
			visibility: TicketVisibility.Private
		});
		const stranger = await seedCustomer(runtime, {
			name: 'Stranger',
			email: 's-stranger@example.com'
		});

		const token = 'sess-stranger-status';
		await seedSession(runtime, stranger.id, token);
		mockCookie(token);
		try {
			const handler = await importRoute('~/server/api/public/status.get');
			mockQuery({ id: ticket.id });
			await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 403 });
		} finally {
			mockCookie(null);
		}
	});

	it('reply.post attributes a participant session reply to the participant (not the owner)', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const owner = await seedCustomer(runtime, { name: 'Owner', email: 'r-owner@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Shared reply',
			description: 'x',
			customer_id: owner.id,
			visibility: TicketVisibility.Public
		});
		await utils.addTicketParticipant(ticket.id, 'r-cc@example.com', runtime.env);
		const cc = await utils.getCustomerByEmail('r-cc@example.com', runtime.env);

		const token = 'sess-participant-reply';
		await seedSession(runtime, cc!.id, token);
		mockCookie(token);
		try {
			const handler = await importRoute('~/server/api/public/reply.post');
			mockBody({ id: ticket.id, message: 'reply from a participant' });
			const result = (await handler(eventFor(runtime.env))) as { sender_kind: string };
			expect(result.sender_kind).toBe('customer');

			const thread = await utils.getTicketThread(ticket.id, runtime.env, null, {
				bypassGate: true
			});
			const last = thread.messages[thread.messages.length - 1];
			expect(last?.sender.kind).toBe('customer');
			expect((last?.sender as any).id).toBe(cc!.id);
			expect((last?.sender as any).id).not.toBe(owner.id);
			expect((last?.sender as any).email).toBe('r-cc@example.com');
		} finally {
			mockCookie(null);
		}
	});
});

describe('GET /api/public/search', () => {
	it('returns only public tickets, each with a status token', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Ann', email: 'ann@example.com' });

		const publicTicket = await seedTicket(runtime, {
			title: 'Login button broken',
			description: 'cannot sign in',
			customer_id: customer.id,
			visibility: TicketVisibility.Public
		});
		await seedTicket(runtime, {
			title: 'Login triage notes',
			description: 'private staff notes',
			customer_id: customer.id,
			visibility: TicketVisibility.Private
		});

		const handler = await importRoute('~/server/api/public/search.get');
		mockQuery({ q: 'login' });
		const result = (await handler(eventFor(runtime.env))) as { results: any[] };

		expect(result.results).toHaveLength(1);
		expect(result.results[0].id).toBe(publicTicket.id);
		expect(result.results[0].title).toBe('Login button broken');

		const utils = await import('#server-utils');
		const expectedToken = await utils.hmacSha256(
			runtime.env.HMAC_SECRET,
			`status:${publicTicket.id}`
		);
		expect(result.results[0].token).toBe(expectedToken);
	});

	it('never returns an internal ticket', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Ann', email: 'ann@example.com' });
		await seedTicket(runtime, {
			title: 'Login internal only',
			description: 'staff eyes only',
			customer_id: customer.id,
			visibility: TicketVisibility.Internal
		});

		const handler = await importRoute('~/server/api/public/search.get');
		mockQuery({ q: 'login' });
		const result = (await handler(eventFor(runtime.env))) as { results: any[] };
		expect(result.results).toHaveLength(0);
	});

	it('browses recent public tickets when no query is given', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Bea', email: 'bea@example.com' });
		await seedTicket(runtime, {
			title: 'Public browseable',
			description: 'anyone can see',
			customer_id: customer.id,
			visibility: TicketVisibility.Public
		});
		await seedTicket(runtime, {
			title: 'Private hidden',
			description: 'not listed',
			customer_id: customer.id,
			visibility: TicketVisibility.Private
		});

		const handler = await importRoute('~/server/api/public/search.get');
		mockQuery({});
		const result = (await handler(eventFor(runtime.env))) as { results: any[] };
		expect(result.results).toHaveLength(1);
		expect(result.results[0].title).toBe('Public browseable');
	});

	async function seedActiveAndArchived() {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const customer = await seedCustomer(runtime, { name: 'Cal', email: 'cal@example.com' });
		const active = await utils.createTicket(
			{
				title: 'Login active issue',
				description: 'still open',
				customer_id: customer.id,
				visibility: TicketVisibility.Public
			},
			runtime.env
		);
		const archived = await utils.createTicket(
			{
				title: 'Login archived issue',
				description: 'resolved long ago',
				customer_id: customer.id,
				visibility: TicketVisibility.Public,
				archived: true
			},
			runtime.env
		);
		return { runtime, active, archived };
	}

	it('excludes archived tickets from the default results', async () => {
		const { runtime, active, archived } = await seedActiveAndArchived();

		const handler = await importRoute('~/server/api/public/search.get');
		mockQuery({ q: 'login' });
		const result = (await handler(eventFor(runtime.env))) as { results: any[] };
		const ids = result.results.map((r) => r.id);
		expect(ids).toContain(active.id);
		expect(ids).not.toContain(archived.id);
	});

	it('returns only archived tickets when archived=1 is set', async () => {
		const { runtime, active, archived } = await seedActiveAndArchived();

		const handler = await importRoute('~/server/api/public/search.get');
		mockQuery({ q: 'login', archived: '1' });
		const result = (await handler(eventFor(runtime.env))) as { results: any[] };
		const ids = result.results.map((r) => r.id);
		expect(ids).toEqual([archived.id]);
		expect(ids).not.toContain(active.id);
		expect(result.results[0].archived).toBe(true);
		expect(typeof result.results[0].token).toBe('string');
	});
});

describe('GET /api/public/status', () => {
	it('enriches the ticket and gives each message a real TicketActor sender', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const customer = await seedCustomer(runtime, { name: 'Ann Owner', email: 'ann@example.com' });

		const ticket = await utils.createTicket(
			{
				title: 'Login button broken',
				description: 'cannot sign in on mobile',
				customer_id: customer.id,
				visibility: TicketVisibility.Public,
				color: '#ff0055',
				icon: 'mdi:bug'
			},
			runtime.env
		);

		// a customer message and a team reply, both public
		await utils.addTicketMessage(
			ticket.id,
			{
				message: 'help please',
				sender: { kind: 'customer', id: customer.id, email: 'ann@example.com', name: 'Ann Owner' }
			},
			runtime.env
		);
		await utils.addTicketMessage(
			ticket.id,
			{
				message: 'looking into it',
				sender: { kind: 'user', id: 'agent-1', username: 'agent', name: 'Casey Agent' }
			},
			runtime.env
		);

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: ticket.id, token: await statusToken(runtime.env, ticket.id) });
		const result = (await handler(eventFor(runtime.env))) as any;

		// enriched header fields (additive to the old thin shape)
		expect(result.id).toBe(ticket.id);
		expect(result.title).toBe('Login button broken');
		expect(result.description).toBe('cannot sign in on mobile');
		expect(result.color).toBe('#ff0055');
		expect(result.icon).toBe('mdi:bug');
		expect(result.visibility).toBe(TicketVisibility.Public);
		expect(result.creator).toEqual({ name: 'Ann Owner', email: 'ann@example.com', staff: false });
		expect(result.can_reply).toBe(true);
		// back-compat fields still present
		expect(result.status).toBeDefined();
		expect(result.priority).toBeDefined();
		expect(typeof result.can_reopen).toBe('boolean');

		// each message carries a real TicketActor sender the shared thread can render
		expect(result.messages).toHaveLength(2);
		expect(result.messages.map((m: any) => m.message)).toEqual(['help please', 'looking into it']);

		const [first, second] = result.messages;
		expect(first.sender).toMatchObject({ kind: 'customer', name: 'Ann Owner' });
		expect(first.private).toBe(false);
		expect(first.id).toBeDefined();
		expect(second.sender).toMatchObject({ kind: 'user', name: 'Casey Agent' });
	});

	it('filters private messages from an unlisted (private) ticket', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const customer = await seedCustomer(runtime, { name: 'Bea', email: 'bea@example.com' });

		// a private-visibility ticket is token-viewable, but its messages are private and must be hidden
		const ticket = await utils.createTicket(
			{
				title: 'Unlisted request',
				description: 'shared only via the status link',
				customer_id: customer.id,
				visibility: TicketVisibility.Private
			},
			runtime.env
		);
		await utils.addTicketMessage(
			ticket.id,
			{
				message: 'private customer note',
				sender: { kind: 'customer', id: customer.id, email: 'bea@example.com', name: 'Bea' }
			},
			runtime.env
		);

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: ticket.id, token: await statusToken(runtime.env, ticket.id) });
		const result = (await handler(eventFor(runtime.env))) as any;

		expect(result.visibility).toBe(TicketVisibility.Private);
		expect(result.messages).toHaveLength(0);
	});

	it('exposes a null creator and can_reply:false for a guest (customer-less) ticket', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const ticket = await utils.createTicket(
			{ title: 'Guest report', description: 'no account', visibility: TicketVisibility.Public },
			runtime.env
		);

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: ticket.id, token: await statusToken(runtime.env, ticket.id) });
		const result = (await handler(eventFor(runtime.env))) as any;

		expect(result.creator).toBeNull();
		// a customer-less (agent-created) ticket has no one to reply as
		expect(result.can_reply).toBe(false);
	});

	it('resolves a staff creator and can_reply:false for an agent-created ticket', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const agent = await seedAgent(runtime, 'creator_agent', 'creator@example.com');
		const ticket = await utils.createTicket(
			{
				title: 'Team ticket',
				description: 'opened by an agent',
				visibility: TicketVisibility.Public,
				created_by: agent.id
			},
			runtime.env
		);

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: ticket.id, token: await statusToken(runtime.env, ticket.id) });
		const result = (await handler(eventFor(runtime.env))) as any;

		expect(result.creator).toMatchObject({ staff: true });
		expect(typeof result.creator.name).toBe('string');
		expect(result.creator.name.length).toBeGreaterThan(0);
		expect(result.can_reply).toBe(false);
	});

	it('reports can_reply:true for a ticket with a real registered customer', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Reg Cust', email: 'regc@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Has a customer',
			description: 'replyable',
			customer_id: customer.id,
			visibility: TicketVisibility.Public
		});

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: ticket.id, token: await statusToken(runtime.env, ticket.id) });
		const result = (await handler(eventFor(runtime.env))) as any;
		expect(result.can_reply).toBe(true);
		expect(result.creator).toMatchObject({ name: 'Reg Cust', staff: false });
	});

	it('rejects an invalid status token', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const customer = await seedCustomer(runtime, { name: 'Ann', email: 'ann@example.com' });
		const ticket = await utils.createTicket(
			{
				title: 'Public',
				description: 'x',
				customer_id: customer.id,
				visibility: TicketVisibility.Public
			},
			runtime.env
		);

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: ticket.id, token: 'not-the-real-token' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 403 });
	});

	it('404s an internal ticket even with a valid token', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const customer = await seedCustomer(runtime, { name: 'Ann', email: 'ann@example.com' });
		const ticket = await utils.createTicket(
			{
				title: 'Internal',
				description: 'staff only',
				customer_id: customer.id,
				visibility: TicketVisibility.Internal
			},
			runtime.env
		);

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: ticket.id, token: await statusToken(runtime.env, ticket.id) });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 404 });
	});
});
