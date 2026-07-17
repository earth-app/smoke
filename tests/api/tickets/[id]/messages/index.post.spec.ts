import { send as edgeportSend } from 'edgeport/smtp';
import { describe, expect, it, vi } from 'vitest';
import { TicketPriority, TicketStatus } from '~/shared/types/ticket';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedAgent,
	seedCustomer,
	seedTicket,
	seedUser,
	useSmtpTransport
} from '../../../route-runtime';

// edgeport opens real TCP sockets; mock it so the outbound mirror is observable without a network
vi.mock('edgeport/smtp', () => ({
	send: vi.fn(async () => ({ accepted: [], response: '250 OK' }))
}));

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

		const handler = await importRoute('~/server/api/tickets/[id]/messages/index.post');
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

		const handler = await importRoute('~/server/api/tickets/[id]/messages/index.post');
		mockParams({ id: ticket.id });
		mockBody({ message: 'denied' });

		await expect(handler(eventFor(runtime.env, limited.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('throws 404 when ticket does not exist', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('~/server/api/tickets/[id]/messages/index.post');
		mockParams({ id: 9999 });
		mockBody({ message: 'lost' });

		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});

	it('mirrors the agent reply to the customer for an email-thread ticket', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		// the mirror goes over edgeport only for a custom smtp transport (cloudflare uses the rest api)
		await useSmtpTransport(runtime);
		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		sendMock.mockClear();

		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'mirror@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Email thread',
			description: 'inbound',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [agent.id]
		});
		await utils.initEmailThread(ticket.id, 'Email thread', 'mirror@example.com');

		const handler = await importRoute('~/server/api/tickets/[id]/messages/index.post');
		mockParams({ id: ticket.id });
		mockBody({ message: 'here is the fix', identity: 'self' });
		await handler(eventFor(runtime.env, agent.sessionToken));

		// the route mirrors the reply to the customer over smtp exactly once
		expect(sendMock).toHaveBeenCalledTimes(1);
		expect(sendMock.mock.calls[0]![0].to).toBe('mirror@example.com');
		expect(sendMock.mock.calls[0]![0].text).toBe('here is the fix');
	});

	it('does not mirror for a non-email-thread ticket', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		sendMock.mockClear();

		// disable event notifications so the reply mirror is the only path that could send
		await utils.setJsonSetting('email', { notifications: false });

		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'no-thread@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Ui only',
			description: 'opened in ui',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [agent.id]
		});

		const handler = await importRoute('~/server/api/tickets/[id]/messages/index.post');
		mockParams({ id: ticket.id });
		mockBody({ message: 'internal reply', identity: 'self' });
		await handler(eventFor(runtime.env, agent.sessionToken));

		// no email thread means no smtp mirror
		expect(sendMock).not.toHaveBeenCalled();
	});
});
