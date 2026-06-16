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
} from '../../../../route-runtime';

describe('DELETE /api/tickets/:id/messages/:messageId', () => {
	it('lets the sender delete their own message', async () => {
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
		const utils = await import('#server-utils');
		const created = await utils.addTicketMessage(
			ticket.id,
			{
				message: 'mine',
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
			'~/server/api/tickets/[id]/messages/[messageId]/index.delete'
		);
		mockParams({ id: ticket.id, messageId: created.id });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).resolves.toBeNull();
	});

	it('lets a manager delete another user’s message', async () => {
		const runtime = getRuntime();
		const author = await seedAgent(runtime, 'author', 'author@example.com');
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'T',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [manager.id, author.id]
		});
		const utils = await import('#server-utils');
		const created = await utils.addTicketMessage(
			ticket.id,
			{
				message: 'mine',
				sender: {
					kind: 'user',
					id: author.id,
					username: 'author',
					email: 'author@example.com'
				}
			},
			runtime.env
		);

		const handler = await importRoute(
			'~/server/api/tickets/[id]/messages/[messageId]/index.delete'
		);
		mockParams({ id: ticket.id, messageId: created.id });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toBeNull();
	});

	it('rejects another agent deleting somebody else’s message', async () => {
		const runtime = getRuntime();
		const author = await seedAgent(runtime, 'author', 'author@example.com');
		const other = await seedAgent(runtime, 'other', 'other@example.com');
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'T',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [author.id, other.id]
		});
		const utils = await import('#server-utils');
		const created = await utils.addTicketMessage(
			ticket.id,
			{
				message: 'mine',
				sender: {
					kind: 'user',
					id: author.id,
					username: 'author',
					email: 'author@example.com'
				}
			},
			runtime.env
		);

		const handler = await importRoute(
			'~/server/api/tickets/[id]/messages/[messageId]/index.delete'
		);
		mockParams({ id: ticket.id, messageId: created.id });

		await expect(handler(eventFor(runtime.env, other.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});
