import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuntime } from '../api/route-runtime';

type EmailHandler = (payload: { message: any; env: any; context: unknown }) => Promise<void>;

async function loadEmailHandler(): Promise<EmailHandler> {
	const plugin = (await import('~/server/plugins/email')).default;
	let handler: EmailHandler | undefined;
	plugin({
		hooks: {
			hook: (name: string, fn: EmailHandler) => {
				if (name === 'cloudflare:email') {
					handler = fn;
				}
			}
		}
	} as any);
	if (!handler) throw new Error('cloudflare:email hook was not registered');
	return handler;
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

// stub the cloudflare destination-address api the engine calls via global fetch
function stubCloudflare(options: { totalCount?: number; verified?: boolean } = {}) {
	const verifiedAt = options.verified ? '2026-01-01T00:00:00Z' : null;
	const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		if (method === 'POST') {
			return jsonResponse({ success: true, result: { id: 'addr-1', verified: verifiedAt } });
		}
		if (method === 'DELETE') {
			return jsonResponse({ success: true, result: null });
		}
		if (String(url).includes('per_page')) {
			return jsonResponse({
				success: true,
				result: [],
				result_info: { total_count: options.totalCount ?? 0 }
			});
		}
		return jsonResponse({ success: true, result: { id: 'addr-1', verified: verifiedAt } });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

type BuildMessageOptions = {
	from: string;
	to?: string;
	subject?: string;
	messageId?: string;
	inReplyTo?: string;
	references?: string;
	body?: string;
};

function buildMessage(options: BuildMessageOptions) {
	const to = options.to ?? 'support@smoke.example.com';
	const lines = [
		`From: ${options.from}`,
		`To: ${to}`,
		options.subject ? `Subject: ${options.subject}` : undefined,
		options.messageId ? `Message-ID: ${options.messageId}` : undefined,
		options.inReplyTo ? `In-Reply-To: ${options.inReplyTo}` : undefined,
		options.references ? `References: ${options.references}` : undefined,
		'Content-Type: text/plain; charset=utf-8',
		'',
		options.body ?? 'Email body.'
	].filter((line): line is string => line !== undefined);

	const headers = new Headers();
	if (options.subject) headers.set('subject', options.subject);
	if (options.messageId) headers.set('message-id', options.messageId);
	if (options.inReplyTo) headers.set('in-reply-to', options.inReplyTo);
	if (options.references) headers.set('references', options.references);

	const envelopeFrom = (options.from.match(/<([^>]+)>/)?.[1] ?? options.from).trim();

	return {
		from: envelopeFrom,
		to,
		headers,
		raw: lines.join('\r\n'),
		reply: vi.fn(async () => ({})),
		setReject: vi.fn()
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('cloudflare:email plugin', () => {
	it('creates a customer + ticket, provisions an address, and auto-acks an unknown sender', async () => {
		const runtime = getRuntime();
		const fetchMock = stubCloudflare({ totalCount: 0 });
		const handler = await loadEmailHandler();

		const message = buildMessage({
			from: '"New User" <new@example.com>',
			subject: 'Support needed',
			messageId: '<u1@example.com>',
			body: 'Please help me with account setup.'
		});
		await handler({ message, env: runtime.env, context: {} });

		const utils = await import('#server-utils');
		const customer = await utils.getCustomerByEmail('new@example.com', runtime.env);
		expect(customer?.email).toBe('new@example.com');
		expect(customer?.name).toBe('New User');

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', null);
		expect(tickets).toHaveLength(1);
		expect(tickets[0]?.title).toBe('Support needed');
		expect(tickets[0]?.description).toBe('Please help me with account setup.');
		expect(tickets[0]?.customer_id).toBe(customer!.id);

		// one synchronous reply, and a destination address was provisioned
		expect(message.reply).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
	});

	it('reuses an existing customer instead of creating a duplicate', async () => {
		const runtime = getRuntime();
		stubCloudflare({ totalCount: 0 });
		const utils = await import('#server-utils');
		const existing = await utils.createCustomer(
			{ name: 'Existing', email: 'existing@example.com' },
			runtime.env
		);

		const handler = await loadEmailHandler();
		await handler({
			message: buildMessage({
				from: 'existing@example.com',
				subject: 'Reply',
				body: 'still need help'
			}),
			env: runtime.env,
			context: {}
		});

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', null);
		expect(tickets).toHaveLength(1);
		expect(tickets[0]?.customer_id).toBe(existing.id);
	});

	it('threads a reply into the existing ticket via the reply alias', async () => {
		const runtime = getRuntime();
		stubCloudflare({ totalCount: 0 });
		const handler = await loadEmailHandler();
		const utils = await import('#server-utils');

		await handler({
			message: buildMessage({
				from: 'thread@example.com',
				subject: 'Broken login',
				body: 'cannot log in'
			}),
			env: runtime.env,
			context: {}
		});

		// customer replies to support+t1@... which routes the mail straight back to the ticket
		await handler({
			message: buildMessage({
				from: 'thread@example.com',
				to: 'support+t1@smoke.example.com',
				subject: 'Re: Broken login',
				body: 'here is more detail'
			}),
			env: runtime.env,
			context: {}
		});

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', null);
		expect(tickets).toHaveLength(1);

		const thread = await utils.getTicketThread(1, runtime.env);
		expect(thread.messages).toHaveLength(1);
		expect(thread.messages[0]?.message).toBe('here is more detail');
		expect(thread.messages[0]?.sender.kind).toBe('customer');
	});

	it('threads a reply via In-Reply-To when the alias is absent', async () => {
		const runtime = getRuntime();
		stubCloudflare({ totalCount: 0 });
		const handler = await loadEmailHandler();
		const utils = await import('#server-utils');

		await handler({
			message: buildMessage({
				from: 'header@example.com',
				subject: 'Need help',
				messageId: '<orig-1@example.com>',
				body: 'initial'
			}),
			env: runtime.env,
			context: {}
		});

		await handler({
			message: buildMessage({
				from: 'header@example.com',
				subject: 'Re: Need help',
				inReplyTo: '<orig-1@example.com>',
				body: 'follow-up over email'
			}),
			env: runtime.env,
			context: {}
		});

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', null);
		expect(tickets).toHaveLength(1);

		const thread = await utils.getTicketThread(1, runtime.env);
		expect(thread.messages).toHaveLength(1);
		expect(thread.messages[0]?.message).toBe('follow-up over email');
	});

	it('disables the thread and skips provisioning when the account is at capacity', async () => {
		const runtime = getRuntime();
		const fetchMock = stubCloudflare({ totalCount: 200 });
		const handler = await loadEmailHandler();
		const utils = await import('#server-utils');

		const message = buildMessage({
			from: 'full@example.com',
			subject: 'Help',
			body: 'at capacity'
		});
		await handler({ message, env: runtime.env, context: {} });

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', null);
		expect(tickets).toHaveLength(1);
		expect(message.reply).toHaveBeenCalledTimes(1);

		// no destination address is created when over the limit
		expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
		// the thread is permanently flagged as email-disabled
		expect(await runtime.hubKv.get('smoke:email_disabled:1')).toBe('1');
	});

	it('replies with a not-configured notice and creates nothing when secrets are missing', async () => {
		const runtime = getRuntime();
		const fetchMock = stubCloudflare({ totalCount: 0 });
		const handler = await loadEmailHandler();
		const utils = await import('#server-utils');

		const message = buildMessage({ from: 'someone@example.com', subject: 'Hello', body: 'hi' });
		await handler({
			message,
			env: { ...runtime.env, CF_API_TOKEN: '' },
			context: {}
		});

		expect(message.reply).toHaveBeenCalledTimes(1);
		expect(fetchMock).not.toHaveBeenCalled();

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', null);
		expect(tickets).toHaveLength(0);
		expect(await utils.getCustomerByEmail('someone@example.com', runtime.env)).toBeNull();
	});

	it('sends a threaded agent reply over email when the customer is verified', async () => {
		const runtime = getRuntime();
		stubCloudflare({ verified: true });
		const utils = await import('#server-utils');

		const email = 'verified@example.com';
		const customer = await utils.createCustomer({ name: 'Verified', email }, runtime.env);
		const ticket = await utils.createTicket(
			{ title: 'Login issue', description: 'cannot log in', customer_id: customer.id },
			runtime.env
		);
		await utils.initEmailThread(ticket.id, 'Login issue', email);

		// mark the customer's destination address as already verified
		const hash = await utils.hmacSha256(runtime.env.HMAC_SECRET, email);
		await runtime.hubKv.set(
			`smoke:email_addr:${hash}`,
			JSON.stringify({ id: 'addr-1', verified: true })
		);

		const sent = await utils.sendTicketEmailReply(
			ticket.id,
			'can you send a screenshot?',
			runtime.env
		);
		expect(sent).toBe(true);
		expect(runtime.env.EMAIL.send).toHaveBeenCalledTimes(1);

		const thread = await runtime.hubKv.get<{ last_message_id?: string; references: string[] }>(
			`smoke:email_thread:${ticket.id}`,
			'json'
		);
		expect(thread?.last_message_id).toBeTruthy();
		expect(thread?.references.length).toBeGreaterThan(0);
	});

	it('does not send an agent reply over email when the customer is unverified', async () => {
		const runtime = getRuntime();
		stubCloudflare({ verified: false });
		const utils = await import('#server-utils');

		const email = 'unverified@example.com';
		const customer = await utils.createCustomer({ name: 'Unverified', email }, runtime.env);
		const ticket = await utils.createTicket(
			{ title: 'Question', description: 'how do i', customer_id: customer.id },
			runtime.env
		);
		await utils.initEmailThread(ticket.id, 'Question', email);

		const sent = await utils.sendTicketEmailReply(ticket.id, 'here is the answer', runtime.env);
		expect(sent).toBe(false);
		expect(runtime.env.EMAIL.send).not.toHaveBeenCalled();
	});

	it('rejects an inbound message without a parseable sender', async () => {
		const runtime = getRuntime();
		stubCloudflare({ totalCount: 0 });
		const handler = await loadEmailHandler();
		const utils = await import('#server-utils');

		const message = buildMessage({ from: '', subject: 'Ignored', body: 'ignored' });
		message.from = '';
		await handler({ message, env: runtime.env, context: {} });

		expect(message.setReject).toHaveBeenCalledTimes(1);
		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', null);
		expect(tickets).toHaveLength(0);
	});
});
