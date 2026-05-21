import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	seedAgent,
	seedCustomer,
	seedUser
} from '../../route-runtime';

describe('POST /api/tickets/:id', () => {
	// This handler mirrors POST /api/tickets — it creates a new ticket. Because
	// it's an alternative entry point, it shares the same auth/permission rules.
	it('creates a ticket when caller has CreateTicket', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const handler = await importRoute('../../../../src/server/api/tickets/[id]/index.post');

		mockBody({
			title: 'Another ticket',
			description: 'desc',
			customer_id: customer.id
		});
		const result = (await handler(eventFor(runtime.env, agent.sessionToken))) as {
			title: string;
			id: number;
		};
		expect(result.title).toBe('Another ticket');
	});

	it('rejects callers without CreateTicket', async () => {
		const runtime = getRuntime();
		const limited = await seedUser(runtime, {
			username: 'limited',
			email: 'limited@example.com',
			permissions: []
		});
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const handler = await importRoute('../../../../src/server/api/tickets/[id]/index.post');

		mockBody({
			title: 'Nope',
			description: 'Nope',
			customer_id: customer.id
		});
		await expect(handler(eventFor(runtime.env, limited.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});
