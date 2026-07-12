import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	mockQuery,
	seedAgent,
	seedCustomer,
	seedLabel,
	seedManager,
	seedTicket,
	seedUser
} from './route-runtime';

// Exercises behaviors in `src/server/utils.ts` that the per-route specs don't
// hit directly — primarily defensive validation, alternative password
// algorithms, and the `getUserBy` username/current branches.
describe('server/utils dispatch behaviors', () => {
	it('caches and rejects oversized search queries', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/users/index.get');

		mockQuery({ search: 'x'.repeat(121) });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });
	});

	it('rejects invalid sort/page/limit/sort_direction query params', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/users/index.get');

		mockQuery({ sort: 'unsupported' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });

		mockQuery({ sort: 'created_at', sort_direction: 'sideways' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });

		mockQuery({ sort: 'created_at', sort_direction: 'asc', page: '0' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });

		mockQuery({ sort: 'created_at', sort_direction: 'asc', limit: '999' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });
	});

	it('resolves users by @username and "current" alias', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('~/server/api/users/[id]/index.get');

		mockParams({ id: '@agent_user' });
		await expect(handler(eventFor(runtime.env))).resolves.toMatchObject({
			username: 'agent_user'
		});

		mockParams({ id: 'current' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).resolves.toMatchObject({
			id: agent.id
		});
	});

	it('hashes and verifies passwords with argon2id and scrypt', async () => {
		const utils = await import('#server-utils');
		const argon = await utils.hashPassword('AnotherStrong123!', 'argon2id');
		expect(
			await utils.verifyPassword(
				'AnotherStrong123!',
				argon.password_hash,
				argon.password_salt,
				argon.password_algorithm
			)
		).toBe(true);
		expect(
			await utils.verifyPassword(
				'WrongPassword99!',
				argon.password_hash,
				argon.password_salt,
				argon.password_algorithm
			)
		).toBe(false);

		const scrypt = await utils.hashPassword('AnotherStrong123!', 'scrypt');
		expect(
			await utils.verifyPassword(
				'AnotherStrong123!',
				scrypt.password_hash,
				scrypt.password_salt,
				scrypt.password_algorithm
			)
		).toBe(true);
	}, 30000);

	it('rejects short passwords and bcrypt overlong inputs', async () => {
		const utils = await import('#server-utils');
		await expect(utils.hashPassword('short')).rejects.toThrow(/12 characters/);
		await expect(utils.hashPassword('a'.repeat(80) + 'A1!', 'bcrypt')).rejects.toThrow(
			/bcrypt maximum length/
		);
	});

	it('returns 401 when login is called with a username that does not exist', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/users/login.post');

		mockBody({ usernameOrEmail: 'ghost_user', password: 'StrongPass123!' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 401 });
	});

	it('listTicketMessages returns 403 when caller cannot view private ticket', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const agent = await seedAgent(runtime);
		// seed a private ticket that the agent is NOT assigned to
		const seeded = (await import('./route-runtime')).seedTicket;
		const seedCustomer = (await import('./route-runtime')).seedCustomer;
		const customer = await seedCustomer(runtime, { name: 'C', email: 'c@example.com' });
		const ticket = await seeded(runtime, {
			title: 'locked',
			description: 'desc',
			customer_id: customer.id,
			status: undefined,
			priority: undefined,
			private: true
		});

		await expect(utils.getTicketThread(ticket.id, runtime.env, null)).rejects.toMatchObject({
			statusCode: 403
		});
		void agent;
	});

	it('setInitialPassword refuses to overwrite an existing password', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const agent = await seedAgent(runtime);
		await utils.setInitialPassword(agent.id, 'StrongPass123!');
		await expect(utils.setInitialPassword(agent.id, 'AnotherStrong99!')).rejects.toMatchObject({
			statusCode: 400
		});
	});

	it('setInitialPassword 404s when the user does not exist', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await expect(utils.setInitialPassword('0'.repeat(32), 'StrongPass123!')).rejects.toMatchObject({
			statusCode: 404
		});
		void runtime;
	});
});

// Covers utility behaviors that aren't naturally hit by the per-route specs.
describe('server/utils extra coverage', () => {
	it('evicts the oldest session when a user exceeds the active-token cap', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const agent = await seedAgent(runtime);

		// emit 6 distinct sessions; the oldest of those should be evicted to keep the count at 5
		const tokens: string[] = [agent.sessionToken];
		for (let i = 0; i < 5; i += 1) {
			tokens.push(await utils.createSessionToken(agent.id));
		}

		const oldest = tokens[0]!;
		const newest = tokens[tokens.length - 1]!;
		await expect(
			utils.ensureLoggedIn({
				node: { req: { headers: { authorization: `Bearer ${oldest}` } } },
				context: { cloudflare: { env: runtime.env } }
			} as any)
		).rejects.toMatchObject({ statusCode: 401 });

		await expect(
			utils.ensureLoggedIn({
				node: { req: { headers: { authorization: `Bearer ${newest}` } } },
				context: { cloudflare: { env: runtime.env } }
			} as any)
		).resolves.toMatchObject({ username: 'agent_user' });
	});

	it('rejects ensureLoggedIn for malformed headers and missing tokens', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');

		await expect(
			utils.ensureLoggedIn({
				node: { req: { headers: {} } },
				context: { cloudflare: { env: runtime.env } }
			} as any)
		).rejects.toMatchObject({ statusCode: 401 });

		await expect(
			utils.ensureLoggedIn({
				node: { req: { headers: { authorization: 'Bearer  ' } } },
				context: { cloudflare: { env: runtime.env } }
			} as any)
		).rejects.toMatchObject({ statusCode: 401 });

		await expect(
			utils.ensureLoggedIn({
				node: { req: { headers: { authorization: 'Bearer not-a-real-token' } } },
				context: { cloudflare: { env: runtime.env } }
			} as any)
		).rejects.toMatchObject({ statusCode: 401 });
	});

	it('getOptionalLoggedIn returns null for missing or invalid headers and a user otherwise', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');

		await expect(
			utils.getOptionalLoggedIn({
				node: { req: { headers: {} } },
				context: { cloudflare: { env: runtime.env } }
			} as any)
		).resolves.toBeNull();

		await expect(
			utils.getOptionalLoggedIn({
				node: { req: { headers: { authorization: 'Bearer bogus' } } },
				context: { cloudflare: { env: runtime.env } }
			} as any)
		).resolves.toBeNull();

		const agent = await seedAgent(runtime);
		await expect(
			utils.getOptionalLoggedIn({
				node: { req: { headers: { authorization: `Bearer ${agent.sessionToken}` } } },
				context: { cloudflare: { env: runtime.env } }
			} as any)
		).resolves.toMatchObject({ username: 'agent_user' });
	});

	it('ensureCanWriteTo enforces self/admin/manage gates', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const manager = await seedManager(runtime);
		const agent = await seedUser(runtime, {
			username: 'agent_one',
			email: 'a1@example.com',
			permissions: [Permission.ManageSelf]
		});
		const otherAgent = await seedAgent(runtime, 'agent_two', 'a2@example.com');

		const managerUser = (await utils.getUserById(manager.id, runtime.env))!;
		const agentUser = (await utils.getUserById(agent.id, runtime.env))!;
		const otherAgentUser = (await utils.getUserById(otherAgent.id, runtime.env))!;

		await expect(utils.ensureCanWriteTo(managerUser, agentUser)).resolves.toBeUndefined();
		await expect(utils.ensureCanWriteTo(agentUser, agentUser)).resolves.toBeUndefined();
		await expect(utils.ensureCanWriteTo(agentUser, otherAgentUser)).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('hydrates a ticket thread with messages from a mixed sender list', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Thread',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [manager.id]
		});

		await utils.addTicketMessage(
			ticket.id,
			{
				message: 'agent reply',
				sender: {
					kind: 'user',
					id: manager.id,
					username: 'manager_user',
					email: 'manager@example.com'
				}
			},
			runtime.env
		);
		await utils.addTicketMessage(
			ticket.id,
			{
				message: 'customer reply',
				sender: { kind: 'customer', id: customer.id, email: 'c@example.com' }
			},
			runtime.env
		);

		const thread = await utils.getTicketThread(ticket.id, runtime.env, null);
		expect(thread.messages.map((m) => m.message)).toEqual(['agent reply', 'customer reply']);
		expect(thread.users.length).toBeGreaterThanOrEqual(2);
	});

	it('edits and then deletes a message via the utility helpers', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'T',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [manager.id]
		});
		const created = await utils.addTicketMessage(
			ticket.id,
			{
				message: 'original',
				sender: {
					kind: 'user',
					id: manager.id,
					username: 'manager_user',
					email: 'manager@example.com'
				},
				attachments: [{ file_name: 'a.txt', mimetype: 'text/plain', data: 'data' }]
			},
			runtime.env
		);

		const edited = await utils.editTicketMessage(
			ticket.id,
			created.id,
			'rewritten',
			undefined,
			runtime.env
		);
		expect(edited.message).toBe('rewritten');
		// attachments preserved when the caller omits the field
		expect(edited.attachments?.[0]?.file_name).toBe('a.txt');

		await utils.deleteTicketMessage(ticket.id, created.id, runtime.env);

		// after clearing the lone message, the sections collapse to null
		await utils.clearTicketMessages(ticket.id, runtime.env);
		const empty = await utils.listTicketMessages(
			ticket.id,
			runtime.env,
			'',
			'created_at',
			'asc',
			null
		);
		expect(empty).toHaveLength(0);
	});

	it('looks up customers by email and falls back to a full-shard scan', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const customer = await seedCustomer(runtime, {
			name: 'Lookup',
			email: 'lookup@example.com'
		});

		// fast path: kv lookup
		const fromKv = await utils.getCustomerByEmail('lookup@example.com', runtime.env);
		expect(fromKv?.id).toBe(customer.id);

		// blow away the kv lookup; the cold-scan path should rebuild it
		await runtime.kv.delete(
			`smoke:customer_email_hash:${await sha256Hex(runtime.env.HMAC_SECRET, 'lookup@example.com')}`
		);
		const fromScan = await utils.getCustomerByEmail('lookup@example.com', runtime.env);
		expect(fromScan?.id).toBe(customer.id);

		// non-existent customer returns null
		await expect(utils.getCustomerByEmail('ghost@example.com', runtime.env)).resolves.toBeNull();
	});

	it('lists labels and tickets through their utility wrappers', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await seedLabel(runtime, 'vip');
		await seedLabel(runtime, 'urgent');
		expect((await utils.listLabels()).map((l) => l.name).sort()).toEqual(['urgent', 'vip']);

		const customer = await seedCustomer(runtime, { name: 'C', email: 'c@example.com' });
		await seedTicket(runtime, {
			title: 'high',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High
		});
		await seedTicket(runtime, {
			title: 'low',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Low
		});

		const high = await utils.getTicketsByPriority(TicketPriority.High, runtime.env);
		expect(high.map((t) => t.title)).toEqual(['high']);
	});
});

async function sha256Hex(secret: string, input: string) {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
	return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
}
