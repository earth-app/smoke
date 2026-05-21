import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus } from '../../../../../src/shared/types/ticket';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockParams,
	seedAgent,
	seedCustomer,
	seedManager,
	seedTicket
} from '../../../route-runtime';

describe('DELETE /api/tickets/:id/messages', () => {
	it('clears every message when caller has ManageTicketMessages', async () => {
		const runtime = getRuntime();
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

		const utils = await import('~/server/utils');
		await utils.addTicketMessage(
			ticket.id,
			{
				message: 'will be cleared',
				sender: {
					kind: 'user',
					id: manager.id,
					username: 'manager_user',
					email: 'manager@example.com'
				}
			},
			runtime.env
		);

		const handler = await importRoute(
			'../../../../../src/server/api/tickets/[id]/messages/index.delete'
		);
		mockParams({ id: ticket.id });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toBeNull();

		const messages = await utils.listTicketMessages(
			ticket.id,
			runtime.env,
			'',
			'created_at',
			'asc',
			null
		);
		expect(messages).toHaveLength(0);
	});

	it('rejects callers without ManageTicketMessages', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'T',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High
		});

		const handler = await importRoute(
			'../../../../../src/server/api/tickets/[id]/messages/index.delete'
		);
		mockParams({ id: ticket.id });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});
