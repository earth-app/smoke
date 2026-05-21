import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus } from '../../../../../src/shared/types/ticket';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedAgent,
	seedCustomer,
	seedTicket,
	seedUser
} from '../../../route-runtime';

describe('POST /api/tickets/:id/messages', () => {
	it('appends a message and round-trips attachments', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Help',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [agent.id]
		});

		const handler = await importRoute(
			'../../../../../src/server/api/tickets/[id]/messages/index.post'
		);
		mockParams({ id: ticket.id });
		mockBody({
			message: 'First reply',
			attachments: [{ file_name: 'notes.txt', mimetype: 'text/plain', data: 'hello' }]
		});

		const result = (await handler(eventFor(runtime.env, agent.sessionToken))) as {
			id: number;
			message: string;
			attachments?: Array<{ file_name: string }>;
		};
		expect(result.message).toBe('First reply');
		expect(result.attachments?.[0]?.file_name).toBe('notes.txt');
	});

	it('rejects callers without ReplyTicket', async () => {
		const runtime = getRuntime();
		const limited = await seedUser(runtime, {
			username: 'limited',
			email: 'limited@example.com',
			permissions: []
		});
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'c@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Help',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High
		});

		const handler = await importRoute(
			'../../../../../src/server/api/tickets/[id]/messages/index.post'
		);
		mockParams({ id: ticket.id });
		mockBody({ message: 'denied' });

		await expect(handler(eventFor(runtime.env, limited.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('throws 404 when ticket does not exist', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute(
			'../../../../../src/server/api/tickets/[id]/messages/index.post'
		);
		mockParams({ id: 9999 });
		mockBody({ message: 'lost' });

		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
