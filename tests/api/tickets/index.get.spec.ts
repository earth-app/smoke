import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus } from '../../../src/shared/types/ticket';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockQuery,
	seedAgent,
	seedCustomer,
	seedManager,
	seedTicket
} from '../route-runtime';

describe('GET /api/tickets', () => {
	it('lists public tickets for unauthenticated callers', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, {
			name: 'Cust',
			email: 'cust@example.com'
		});
		await seedTicket(runtime, {
			title: 'Public ticket',
			description: 'visible',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			private: false
		});
		await seedTicket(runtime, {
			title: 'Private ticket',
			description: 'hidden',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Low,
			private: true
		});
		const handler = await importRoute('../../../src/server/api/tickets/index.get');

		mockQuery({});
		const result = (await handler(eventFor(runtime.env))) as Array<{ title: string }>;
		expect(result.map((t) => t.title)).toEqual(['Public ticket']);
	});

	it('includes private tickets when caller is an assignee', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Cust',
			email: 'cust@example.com'
		});
		await seedTicket(runtime, {
			title: 'Assigned private',
			description: 'visible to assignee',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [agent.id],
			private: true
		});
		const handler = await importRoute('../../../src/server/api/tickets/index.get');

		mockQuery({});
		const result = (await handler(eventFor(runtime.env, agent.sessionToken))) as Array<{
			title: string;
		}>;
		expect(result.map((t) => t.title)).toEqual(['Assigned private']);
	});

	it('shows every ticket to managers (ViewPrivateTickets unnecessary)', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Cust',
			email: 'cust@example.com'
		});
		await seedTicket(runtime, {
			title: 'Public',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			private: false
		});
		await seedTicket(runtime, {
			title: 'Private',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			private: true,
			assignee_ids: [manager.id]
		});
		const handler = await importRoute('../../../src/server/api/tickets/index.get');

		mockQuery({});
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as Array<{
			title: string;
		}>;
		expect(result.map((t) => t.title).sort()).toEqual(['Private', 'Public']);
	});
});
