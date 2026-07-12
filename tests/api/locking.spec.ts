import { describe, expect, it } from 'vitest';
import { TicketStatus, TicketVisibility } from '~/shared/types/ticket';
import { Permission, Role } from '~/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedAgent,
	seedCustomer,
	seedManager,
	seedTicket,
	seedUser
} from './route-runtime';

// the harness MANAGER_PERMISSIONS subset omits LockThread; an admin gets every permission
async function seedLocker(rt: ReturnType<typeof getRuntime>) {
	return await seedUser(rt, {
		username: 'lockadmin',
		email: 'lockadmin@example.com',
		role: Role.Admin
	});
}

async function seedBasicTicket() {
	const rt = getRuntime();
	const customer = await seedCustomer(rt, { name: 'Ann', email: 'ann@example.com' });
	const ticket = await seedTicket(rt, {
		title: 'Login broken',
		description: 'cannot sign in',
		customer_id: customer.id
	});
	return { rt, ticket };
}

async function seedPublicTicket() {
	const rt = getRuntime();
	const customer = await seedCustomer(rt, { name: 'Ann', email: 'ann@example.com' });
	const ticket = await seedTicket(rt, {
		title: 'Login broken',
		description: 'cannot sign in',
		customer_id: customer.id,
		visibility: TicketVisibility.Public
	});
	return { rt, ticket };
}

describe('POST /api/tickets/[id]/lock', () => {
	it('locks a thread for a user with LockThread', async () => {
		const { rt, ticket } = await seedBasicTicket();
		const locker = await seedLocker(rt);

		const handler = await importRoute('~/server/api/tickets/[id]/lock.post');
		mockParams({ id: ticket.id });
		mockBody({ locked: true });
		const result = (await handler(eventFor(rt.env, locker.sessionToken))) as any;
		expect(result.locked).toBe(true);

		const utils = await import('#server-utils');
		const meta = await utils.getTicketMeta(ticket.id);
		expect(meta.locked).toBe(true);
	});

	it('unlocks a thread when locked is false', async () => {
		const { rt, ticket } = await seedBasicTicket();
		const locker = await seedLocker(rt);

		const utils = await import('#server-utils');
		await utils.patchTicket(ticket.id, { locked: true }, rt.env);

		const handler = await importRoute('~/server/api/tickets/[id]/lock.post');
		mockParams({ id: ticket.id });
		mockBody({ locked: false });
		const result = (await handler(eventFor(rt.env, locker.sessionToken))) as any;
		expect(result.locked).toBe(false);
	});

	it('rejects an agent without LockThread', async () => {
		const { rt, ticket } = await seedBasicTicket();
		const agent = await seedAgent(rt);

		const handler = await importRoute('~/server/api/tickets/[id]/lock.post');
		mockParams({ id: ticket.id });
		mockBody({ locked: true });
		await expect(handler(eventFor(rt.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});

describe('POST /api/tickets/[id]/archive', () => {
	it('archives a ticket for a manager with ManageTicket', async () => {
		const { rt, ticket } = await seedBasicTicket();
		const manager = await seedManager(rt);

		const handler = await importRoute('~/server/api/tickets/[id]/archive.post');
		mockParams({ id: ticket.id });
		mockBody({ archived: true });
		const result = (await handler(eventFor(rt.env, manager.sessionToken))) as any;
		expect(result.archived).toBe(true);
		expect(result.archived_at).toBeTruthy();
	});

	it('rejects an agent without ManageTicket', async () => {
		const { rt, ticket } = await seedBasicTicket();
		const agent = await seedAgent(rt);

		const handler = await importRoute('~/server/api/tickets/[id]/archive.post');
		mockParams({ id: ticket.id });
		mockBody({ archived: true });
		await expect(handler(eventFor(rt.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});

describe('POST /api/public/reopen', () => {
	it('reopens a closed thread and clears locked + archived', async () => {
		const { rt, ticket } = await seedBasicTicket();
		const utils = await import('#server-utils');
		await utils.patchTicket(
			ticket.id,
			{ status: TicketStatus.Closed, locked: true, archived: true },
			rt.env
		);
		const token = await utils.hmacSha256(rt.env.HMAC_SECRET, `status:${ticket.id}`);

		const handler = await importRoute('~/server/api/public/reopen.post');
		mockBody({ id: ticket.id, token });
		const result = (await handler(eventFor(rt.env))) as any;
		expect(result.id).toBe(ticket.id);
		expect(result.status).toBe(TicketStatus.Open);

		const meta = await utils.getTicketMeta(ticket.id);
		expect(meta.locked).toBe(false);
		expect(meta.archived).toBe(false);
	});

	it('rejects a bad status token', async () => {
		const { rt, ticket } = await seedBasicTicket();

		const handler = await importRoute('~/server/api/public/reopen.post');
		mockBody({ id: ticket.id, token: 'not-the-token' });
		await expect(handler(eventFor(rt.env))).rejects.toMatchObject({ statusCode: 403 });
	});

	it('refuses to reopen when customer_reopen is disabled', async () => {
		const { rt, ticket } = await seedBasicTicket();
		const utils = await import('#server-utils');
		await utils.patchTicket(ticket.id, { status: TicketStatus.Closed }, rt.env);
		await utils.setJsonSetting('locking', { customer_reopen: false });
		const token = await utils.hmacSha256(rt.env.HMAC_SECRET, `status:${ticket.id}`);

		const handler = await importRoute('~/server/api/public/reopen.post');
		mockBody({ id: ticket.id, token });
		await expect(handler(eventFor(rt.env))).rejects.toMatchObject({ statusCode: 403 });
	});
});

describe('POST /api/tickets/[id]/messages lock gate', () => {
	it('rejects a reply on a locked thread from a user without ChatInLocked', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		await utils.patchTicket(ticket.id, { locked: true }, rt.env);

		const user = await seedUser(rt, {
			username: 'nolock_agent',
			email: 'nolock@example.com',
			role: Role.Agent,
			permissions: [Permission.ReplyTicket]
		});

		const handler = await importRoute('~/server/api/tickets/[id]/messages/index.post');
		mockParams({ id: ticket.id });
		mockBody({ message: 'still stuck' });
		await expect(handler(eventFor(rt.env, user.sessionToken))).rejects.toMatchObject({
			statusCode: 423
		});
	});

	it('allows a reply on a locked thread from a user with ChatInLocked', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		await utils.patchTicket(ticket.id, { locked: true }, rt.env);

		const user = await seedUser(rt, {
			username: 'canlock_agent',
			email: 'canlock@example.com',
			role: Role.Agent,
			permissions: [Permission.ReplyTicket, Permission.ChatInLocked]
		});

		const handler = await importRoute('~/server/api/tickets/[id]/messages/index.post');
		mockParams({ id: ticket.id });
		mockBody({ message: 'internal follow up' });
		const result = (await handler(eventFor(rt.env, user.sessionToken))) as any;
		expect(result.message).toBe('internal follow up');
	});
});

describe('POST /api/tickets/[id]/messages archived gate', () => {
	it('rejects a reply on an archived thread even with ChatInLocked', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		// archived is read-only regardless of lock permissions until unarchived
		await utils.patchTicket(ticket.id, { archived: true }, rt.env);

		const user = await seedUser(rt, {
			username: 'archive_agent',
			email: 'archive@example.com',
			role: Role.Agent,
			permissions: [Permission.ReplyTicket, Permission.ChatInLocked]
		});

		const handler = await importRoute('~/server/api/tickets/[id]/messages/index.post');
		mockParams({ id: ticket.id });
		mockBody({ message: 'reopening the discussion' });
		await expect(handler(eventFor(rt.env, user.sessionToken))).rejects.toMatchObject({
			statusCode: 423
		});
	});

	it('allows a reply again after the ticket is unarchived', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		await utils.patchTicket(ticket.id, { archived: true }, rt.env);
		await utils.patchTicket(ticket.id, { archived: false }, rt.env);

		const user = await seedUser(rt, {
			username: 'reactivated_agent',
			email: 'reactivated@example.com',
			role: Role.Agent,
			permissions: [Permission.ReplyTicket]
		});

		const handler = await importRoute('~/server/api/tickets/[id]/messages/index.post');
		mockParams({ id: ticket.id });
		mockBody({ message: 'back in business' });
		const result = (await handler(eventFor(rt.env, user.sessionToken))) as any;
		expect(result.message).toBe('back in business');
	});
});

describe('patchTicket auto-lock on close', () => {
	it('locks the thread when closing and auto_lock_on_close is enabled', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		await utils.setJsonSetting('locking', { auto_lock_on_close: true });

		await utils.patchTicket(ticket.id, { status: TicketStatus.Closed }, rt.env, {
			skipFlows: true
		});
		const meta = await utils.getTicketMeta(ticket.id);
		expect(meta.locked).toBe(true);
	});

	it('does not lock on close when auto_lock_on_close is off', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');

		await utils.patchTicket(ticket.id, { status: TicketStatus.Closed }, rt.env, {
			skipFlows: true
		});
		const meta = await utils.getTicketMeta(ticket.id);
		expect(meta.locked ?? false).toBe(false);
	});
});
