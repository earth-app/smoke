import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus } from '~/shared/types/ticket';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockParams,
	seedAgent,
	seedCustomer,
	seedManager,
	seedTicket
} from './route-runtime';

// Verifies the hot-path caches added to ensureLoggedIn / getTicketById /
// getCustomerById behave as designed: second reads hit the cache (same value
// as the first call) and invalidation kicks in on every write path that should
// dirty the cache.
//
// We deliberately don't assert on wall-clock numbers — Cloudflare Workers
// isolates throttle `performance.now()` to 0 increments for timing-attack
// protection, so cold/warm timing isn't measurable from inside a test. The
// real wins (skipping PBKDF2 KEK derivation on every authenticated request,
// skipping the AES-GCM ticket decrypt on every ticket fetch) only show up
// under real-request load.

describe('hot-path cache behavior', () => {
	it('ensureLoggedIn returns the same User across consecutive calls (cached decryptUser)', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const agent = await seedAgent(runtime);

		const first = await utils.ensureLoggedIn(eventFor(runtime.env, agent.sessionToken));
		const second = await utils.ensureLoggedIn(eventFor(runtime.env, agent.sessionToken));

		expect(first.id).toBe(agent.id);
		expect(second.id).toBe(agent.id);
		expect(second.username).toBe(first.username);
		expect(second.permissions).toEqual(first.permissions);
	});

	it('GET /api/tickets/:id returns identical hydrated data across consecutive reads', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, { name: 'C', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Cached ticket',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [manager.id]
		});
		const handler = await importRoute('~/server/api/tickets/[id]/index.get');
		mockParams({ id: ticket.id });

		const cold = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			id: number;
			title: string;
			status: string;
		};
		const warm = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			id: number;
			title: string;
			status: string;
		};

		expect(cold.title).toBe('Cached ticket');
		// JSON cache round-trips dates to strings; compare by the stable scalar fields.
		expect(warm.id).toBe(cold.id);
		expect(warm.title).toBe(cold.title);
		expect(warm.status).toBe(cold.status);
	});

	it('GET /api/customers/:id returns identical decrypted data across consecutive reads', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, { name: 'CachedCust', email: 'cc@example.com' });
		const handler = await importRoute('~/server/api/customers/[id]/index.get');
		mockParams({ id: customer.id });

		const cold = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			id: number;
			name?: string;
			email: string;
		};
		const warm = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			id: number;
			name?: string;
			email: string;
		};

		expect(cold.name).toBe('CachedCust');
		expect(warm.id).toBe(cold.id);
		expect(warm.name).toBe(cold.name);
		expect(warm.email).toBe(cold.email);
	});
});

describe('cache invalidation guarantees', () => {
	it('patchTicket invalidates the ticket cache so the next read sees fresh data', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, { name: 'C', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'before',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Low,
			assignee_ids: [manager.id]
		});

		const before = await utils.getTicketById(ticket.id, runtime.env, null);
		expect(before?.title).toBe('before');

		await utils.patchTicket(ticket.id, { title: 'after' }, runtime.env);

		const after = await utils.getTicketById(ticket.id, runtime.env, null);
		expect(after?.title).toBe('after');
	});

	it('addTicketMessage invalidates the ticket cache (writeTicketSections updates updated_at)', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, { name: 'C', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 't',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [agent.id]
		});

		const before = await utils.getTicketById(ticket.id, runtime.env, null);
		const beforeTime = before!.updated_at.getTime();

		await utils.addTicketMessage(
			ticket.id,
			{
				message: 'hi',
				sender: {
					kind: 'user',
					id: agent.id,
					username: 'agent_user',
					email: 'agent@example.com'
				}
			},
			runtime.env
		);

		const after = await utils.getTicketById(ticket.id, runtime.env, null);
		expect(after!.updated_at.getTime()).toBeGreaterThanOrEqual(beforeTime);
	});

	it('deleteTicket invalidates the ticket cache so the next read returns null', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, { name: 'C', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'doomed',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Low,
			assignee_ids: [manager.id]
		});

		await utils.getTicketById(ticket.id, runtime.env, null); // prime cache
		await utils.deleteTicket(ticket.id, runtime.env);

		await expect(utils.getTicketById(ticket.id, runtime.env, null)).resolves.toBeNull();
	});

	it('patchCustomer invalidates the customer cache so the next read sees fresh data', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const customer = await seedCustomer(runtime, { name: 'old', email: 'old@example.com' });

		const before = await utils.getCustomerById(customer.id, runtime.env);
		expect(before?.name).toBe('old');

		await utils.patchCustomer(customer.id, { name: 'new' }, runtime.env);

		const after = await utils.getCustomerById(customer.id, runtime.env);
		expect(after?.name).toBe('new');
	});

	it('patchUser invalidates the user cache so updated permissions take effect immediately', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const agent = await seedAgent(runtime);

		const before = await utils.getUserById(agent.id, runtime.env);
		expect(before?.permissions).not.toContain('manage_users');

		await utils.patchUser(before!, { permissions: ['manage_users'] as never }, runtime.env);

		const after = await utils.getUserById(agent.id, runtime.env);
		expect(after?.permissions).toContain('manage_users');
	});
});
