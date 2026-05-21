import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus } from '../../../../../../src/shared/types/ticket';
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
} from '../../../../route-runtime';

describe('PATCH /api/tickets/:id/messages/:messageId', () => {
	it('lets the sender edit their own message', async () => {
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
				message: 'original',
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
			'../../../../../../src/server/api/tickets/[id]/messages/[messageId]/index.patch'
		);
		mockParams({ id: ticket.id, messageId: created.id });
		mockBody({ message: 'edited' });

		const result = (await handler(eventFor(runtime.env, agent.sessionToken))) as {
			message: string;
		};
		expect(result.message).toBe('edited');
	});

	it('lets a manager edit someone else’s message', async () => {
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
		const utils = await import('~/server/utils');
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
			'../../../../../../src/server/api/tickets/[id]/messages/[messageId]/index.patch'
		);
		mockParams({ id: ticket.id, messageId: created.id });
		mockBody({ message: 'rewritten by manager' });

		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toMatchObject({
			message: 'rewritten by manager'
		});
	});

	it('rejects another agent editing somebody else’s message', async () => {
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
		const utils = await import('~/server/utils');
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
			'../../../../../../src/server/api/tickets/[id]/messages/[messageId]/index.patch'
		);
		mockParams({ id: ticket.id, messageId: created.id });
		mockBody({ message: 'hijack' });

		await expect(handler(eventFor(runtime.env, other.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});
