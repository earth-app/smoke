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
} from '../../route-runtime';

describe('DELETE /api/tickets/:id', () => {
	it('deletes a ticket when caller has ManageTicket', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Bye',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Low
		});
		const handler = await importRoute('~/server/api/tickets/[id]/index.delete');

		mockParams({ id: ticket.id });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toBeNull();

		const row = await runtime.db
			.prepare('SELECT id FROM tickets WHERE id = ?')
			.bind(ticket.id)
			.first();
		expect(row).toBeNull();
	});

	it('rejects callers without ManageTicket', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Bye',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Low
		});
		const handler = await importRoute('~/server/api/tickets/[id]/index.delete');

		mockParams({ id: ticket.id });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('throws 404 when ticket does not exist', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute('~/server/api/tickets/[id]/index.delete');

		mockParams({ id: 9999 });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
