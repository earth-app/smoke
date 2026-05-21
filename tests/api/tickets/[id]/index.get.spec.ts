import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus } from '../../../../src/shared/types/ticket';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockParams,
	seedCustomer,
	seedManager,
	seedTicket
} from '../../route-runtime';

describe('GET /api/tickets/:id', () => {
	it('returns the ticket by id', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Broken',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High
		});
		const handler = await importRoute('../../../../src/server/api/tickets/[id]/index.get');

		mockParams({ id: ticket.id });
		await expect(handler(eventFor(runtime.env))).resolves.toMatchObject({
			id: ticket.id,
			title: 'Broken'
		});
	});

	it('throws 404 when private ticket is accessed without permission', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Locked',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			private: true
		});
		const handler = await importRoute('../../../../src/server/api/tickets/[id]/index.get');

		mockParams({ id: ticket.id });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 404 });
	});

	it('returns private ticket when caller is a manager', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Locked',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			private: true
		});
		const handler = await importRoute('../../../../src/server/api/tickets/[id]/index.get');

		mockParams({ id: ticket.id });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toMatchObject({
			id: ticket.id,
			private: true
		});
	});
});
