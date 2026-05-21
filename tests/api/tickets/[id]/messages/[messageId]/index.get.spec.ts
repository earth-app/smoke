import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus } from '../../../../../../src/shared/types/ticket';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockParams,
	seedAgent,
	seedCustomer,
	seedTicket
} from '../../../../route-runtime';

describe('GET /api/tickets/:id/messages/:messageId', () => {
	it('returns the message body for a valid id pair', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'T',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [agent.id]
		});
		const utils = await import('~/server/utils');
		const created = await utils.addTicketMessage(
			ticket.id,
			{
				message: 'hello',
				sender: {
					kind: 'user',
					id: agent.id,
					username: 'agent_user',
					email: 'agent@example.com'
				}
			},
			runtime.env
		);

		const handler = await importRoute(
			'../../../../../../src/server/api/tickets/[id]/messages/[messageId]/index.get'
		);
		mockParams({ id: ticket.id, messageId: created.id });

		await expect(handler(eventFor(runtime.env, agent.sessionToken))).resolves.toMatchObject({
			id: created.id,
			message: 'hello'
		});
	});

	it('throws 404 when message id is out of range', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'T',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High
		});

		const handler = await importRoute(
			'../../../../../../src/server/api/tickets/[id]/messages/[messageId]/index.get'
		);
		mockParams({ id: ticket.id, messageId: 100 });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 404 });
	});
});
