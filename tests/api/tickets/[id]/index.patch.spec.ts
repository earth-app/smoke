import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus } from '../../../../src/shared/types/ticket';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedAgent,
	seedCustomer,
	seedManager,
	seedTicket
} from '../../route-runtime';

describe('PATCH /api/tickets/:id', () => {
	it('updates the ticket when caller has ManageTicket', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Old title',
			description: 'old',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Low
		});
		const handler = await importRoute('../../../../src/server/api/tickets/[id]/index.patch');

		mockParams({ id: ticket.id });
		mockBody({ title: 'New title', priority: TicketPriority.High });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toMatchObject({
			id: ticket.id,
			title: 'New title',
			priority: TicketPriority.High
		});
	});

	it('rejects callers without ManageTicket', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Old',
			description: 'old',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Low
		});
		const handler = await importRoute('../../../../src/server/api/tickets/[id]/index.patch');

		mockParams({ id: ticket.id });
		mockBody({ title: 'New' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('throws 404 when the ticket does not exist', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute('../../../../src/server/api/tickets/[id]/index.patch');

		mockParams({ id: 9999 });
		mockBody({ title: 'whatever' });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
