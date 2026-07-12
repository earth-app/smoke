import { send as edgeportSend } from 'edgeport/smtp';
import { describe, expect, it, vi } from 'vitest';
import { TicketVisibility } from '~/shared/types/ticket';
import { Permission, Role } from '~/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedCustomer,
	seedManager,
	seedTicket,
	seedUser
} from '../../route-runtime';

// edgeport opens real sockets; mock it so the invite path is observable without a network
vi.mock('edgeport/smtp', () => ({
	send: vi.fn(async () => ({ accepted: [], response: '250 OK' }))
}));

async function seedOwnedTicket() {
	const rt = getRuntime();
	const customer = await seedCustomer(rt, { name: 'Owner', email: 'owner@example.com' });
	const ticket = await seedTicket(rt, {
		title: 'Need access',
		description: 'please help',
		customer_id: customer.id,
		visibility: TicketVisibility.Public
	});
	return { rt, customer, ticket };
}

describe('POST /api/tickets/:id/emails', () => {
	it('adds a participant and emails them an access invite (AddEmail)', async () => {
		const { rt, ticket } = await seedOwnedTicket();
		const manager = await seedManager(rt);
		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		sendMock.mockClear();

		const handler = await importRoute('~/server/api/tickets/[id]/emails.post');
		mockParams({ id: ticket.id });
		mockBody({ email: 'CC@Example.com', note: 'looping you in' });
		const result = (await handler(eventFor(rt.env, manager.sessionToken))) as {
			participants: string[];
		};
		expect(result.participants).toEqual(['cc@example.com']);

		// invite sent to the participant over the mocked transport, carrying the portal link
		const invite = sendMock.mock.calls.find((c) => c[0]?.to === 'cc@example.com');
		expect(invite).toBeDefined();
		expect(String(invite![0].text)).toContain('/portal/login');

		const utils = await import('#server-utils');
		expect(await utils.getTicketParticipants(ticket.id)).toEqual(['cc@example.com']);

		// an internal note records the forward for staff
		const thread = await utils.getTicketThread(ticket.id, rt.env, {
			id: 'sys',
			permissions: [Permission.ViewPrivateTickets]
		} as any);
		expect(thread.messages.some((m: any) => m.message.includes('Forwarded to'))).toBe(true);
	});

	it('rejects a caller without AddEmail (403)', async () => {
		const { rt, ticket } = await seedOwnedTicket();
		const noPerm = await seedUser(rt, {
			username: 'noaddperm',
			email: 'noadd@example.com',
			role: Role.Agent,
			permissions: [Permission.ReplyTicket]
		});

		const handler = await importRoute('~/server/api/tickets/[id]/emails.post');
		mockParams({ id: ticket.id });
		mockBody({ email: 'blocked@example.com' });
		await expect(handler(eventFor(rt.env, noPerm.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('404s a missing ticket', async () => {
		const rt = getRuntime();
		const manager = await seedManager(rt);

		const handler = await importRoute('~/server/api/tickets/[id]/emails.post');
		mockParams({ id: 999999 });
		mockBody({ email: 'nobody@example.com' });
		await expect(handler(eventFor(rt.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});

describe('DELETE /api/tickets/:id/emails', () => {
	it('removes a participant (RemoveEmail)', async () => {
		const { rt, ticket } = await seedOwnedTicket();
		const manager = await seedManager(rt);
		const utils = await import('#server-utils');
		await utils.addTicketParticipant(ticket.id, 'cc@example.com', rt.env);

		const handler = await importRoute('~/server/api/tickets/[id]/emails.delete');
		mockParams({ id: ticket.id });
		mockBody({ email: 'cc@example.com' });
		const result = (await handler(eventFor(rt.env, manager.sessionToken))) as {
			participants: string[];
		};
		expect(result.participants).toEqual([]);
		expect(await utils.getTicketParticipants(ticket.id)).toEqual([]);
	});

	it('rejects a caller without RemoveEmail (403)', async () => {
		const { rt, ticket } = await seedOwnedTicket();
		const noPerm = await seedUser(rt, {
			username: 'noremoveperm',
			email: 'norem@example.com',
			role: Role.Agent,
			permissions: [Permission.ReplyTicket]
		});

		const handler = await importRoute('~/server/api/tickets/[id]/emails.delete');
		mockParams({ id: ticket.id });
		mockBody({ email: 'cc@example.com' });
		await expect(handler(eventFor(rt.env, noPerm.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});
