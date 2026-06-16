import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus } from '~/shared/types/ticket';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockParams,
	mockQuery,
	seedAgent,
	seedCustomer,
	seedTicket
} from '../../../route-runtime';

describe('GET /api/tickets/:id/messages', () => {
	it('returns messages for the ticket including freshly added ones', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Need help',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [agent.id]
		});

		const utils = await import('#server-utils');
		await utils.addTicketMessage(
			ticket.id,
			{
				message: 'first reply',
				sender: {
					kind: 'user',
					id: agent.id,
					username: 'agent_user',
					email: 'agent@example.com'
				}
			},
			runtime.env
		);

		const handler = await importRoute('~/server/api/tickets/[id]/messages/index.get');
		mockParams({ id: ticket.id });
		mockQuery({});

		const result = (await handler(eventFor(runtime.env, agent.sessionToken))) as Array<{
			message: string;
		}>;
		expect(result.map((m) => m.message)).toEqual(['first reply']);
	});

	it('throws 404 when the ticket does not exist', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/tickets/[id]/messages/index.get');
		mockParams({ id: 9999 });
		mockQuery({});
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 404 });
	});
});
