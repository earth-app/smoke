import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ticket } from '~/shared/types/ticket';
import { TicketStatus } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';
import { getRuntime, seedCustomer, seedTicket, seedUser, type RouteRuntime } from './route-runtime';

// route-runtime imports #server-utils (barrel) which registers every server-util on globalThis; grab
// the engine funcs via a dynamic import so prettier can't hoist the barrel above route-runtime
let utils: typeof import('#server-utils');

// privileged reader so private tickets hydrate with their assignees for the notify resolver
const viewer = { id: 'sys', permissions: [Permission.ViewPrivateTickets] } as any;

// captures every sendCustomerEmail call; the notify util resolves it off globalThis at runtime
let sent: { to: string; subject: string; body: string }[];

beforeEach(async () => {
	utils = await import('#server-utils');
	sent = [];
	(globalThis as any).sendCustomerEmail = vi.fn(
		async (to: string, subject: string, body: string) => {
			sent.push({ to, subject, body });
			return true;
		}
	);
});

const env = () => getRuntime().env;

// seed a customer + two agents + a ticket assigned to both, then hydrate it
async function seedAssignedTicket(rt: RouteRuntime): Promise<{
	ticket: Ticket;
	customerEmail: string;
	agentA: { id: string; email: string };
	agentB: { id: string; email: string };
}> {
	const customer = await seedCustomer(rt, { name: 'Cust', email: 'cust@example.com' });
	const a = await seedUser(rt, { username: 'agent_a', email: 'agent_a@example.com' });
	const b = await seedUser(rt, { username: 'agent_b', email: 'agent_b@example.com' });

	const seeded = await seedTicket(rt, {
		title: 'Broken Login',
		description: 'cannot sign in',
		customer_id: customer.id,
		assignee_ids: [a.id, b.id]
	});
	const ticket = (await utils.getTicketById(seeded.id, rt.env, viewer)) as Ticket;
	expect(ticket).toBeTruthy();

	return {
		ticket,
		customerEmail: 'cust@example.com',
		agentA: { id: a.id, email: 'agent_a@example.com' },
		agentB: { id: b.id, email: 'agent_b@example.com' }
	};
}

const recipients = () => sent.map((s) => s.to).sort();

describe('notifyTicketEvent', () => {
	it('notifies the customer + assignees on a message, but not the acting agent', async () => {
		const rt = getRuntime();
		const { ticket, customerEmail, agentA, agentB } = await seedAssignedTicket(rt);

		await utils.notifyTicketEvent('message', ticket, rt.env, {
			actorId: agentA.id,
			message: 'Here is the fix you asked for.'
		});

		expect(recipients()).toEqual([agentB.email, customerEmail].sort());
		expect(sent.some((s) => s.to === agentA.email)).toBe(false);
		// the message preview rides along in the body
		const agentMail = sent.find((s) => s.to === agentB.email)!;
		expect(agentMail.subject).toContain('New Message on Ticket');
		expect(agentMail.body).toContain('Here is the fix you asked for.');
		expect(agentMail.body).toContain('/dashboard/tickets/');
		// the customer gets a tokenized status link, not the dashboard
		const custMail = sent.find((s) => s.to === customerEmail)!;
		expect(custMail.body).toContain('/status/');
		expect(custMail.body).toContain(`?id=${ticket.id}`);
	});

	it('sends nothing for a MESSAGE on an email-thread ticket', async () => {
		const rt = getRuntime();
		const { ticket } = await seedAssignedTicket(rt);

		// seeding the thread key marks this as an email-mirror ticket
		await utils.initEmailThread(ticket.id, 'Broken Login', 'cust@example.com');

		await utils.notifyTicketEvent('message', ticket, rt.env, { message: 'x' });
		expect(sent).toHaveLength(0);
	});

	it('notifies everyone on a generic status change with from/to labels', async () => {
		const rt = getRuntime();
		const { ticket, customerEmail, agentA, agentB } = await seedAssignedTicket(rt);

		await utils.notifyTicketEvent('status', ticket, rt.env, {
			fromStatus: 'open',
			toStatus: 'work_in_progress'
		});

		expect(recipients()).toEqual([agentA.email, agentB.email, customerEmail].sort());
		const custMail = sent.find((s) => s.to === customerEmail)!;
		expect(custMail.subject).toContain('Status Updated');
		expect(custMail.body).toContain('from Open to Work In Progress');
	});

	it('STILL notifies on a state change for an email-thread ticket (only messages skip)', async () => {
		const rt = getRuntime();
		const { ticket, customerEmail } = await seedAssignedTicket(rt);
		await utils.initEmailThread(ticket.id, 'Broken Login', 'cust@example.com');

		// the reported bug: closing an email-thread ticket sent the customer nothing
		await utils.notifyTicketEvent('closed', ticket, rt.env);
		expect(recipients()).toContain(customerEmail);

		sent = [];
		await utils.notifyTicketEvent('status', ticket, rt.env, {
			fromStatus: 'open',
			toStatus: 'pending'
		});
		expect(recipients()).toContain(customerEmail);

		// but a message on the same email-thread ticket is still suppressed (the mirror covers it)
		sent = [];
		await utils.notifyTicketEvent('message', ticket, rt.env, { message: 'x' });
		expect(sent).toHaveLength(0);
	});

	it('emails the customer end-to-end when a ticket is closed via patchTicket', async () => {
		const rt = getRuntime();
		const customer = await seedCustomer(rt, { name: 'C', email: 'e2e@example.com' });
		const seeded = await seedTicket(rt, {
			title: 'Login broken',
			description: 'help',
			customer_id: customer.id,
			status: TicketStatus.Open
		});

		sent = [];
		await utils.patchTicket(seeded.id, { status: TicketStatus.Closed }, rt.env, {
			actorId: 'staff-x'
		});
		const custMail = sent.find((s) => s.to === 'e2e@example.com');
		expect(custMail).toBeTruthy();
		expect(custMail!.subject).toContain('Closed');
	});

	it('includes ticket participants as customer-facing recipients', async () => {
		const rt = getRuntime();
		const { ticket } = await seedAssignedTicket(rt);
		ticket.participants = ['cc@example.com'];

		await utils.notifyTicketEvent('status', ticket, rt.env, {
			fromStatus: 'open',
			toStatus: 'pending'
		});
		expect(recipients()).toContain('cc@example.com');
	});

	it('respects the notifications-off setting', async () => {
		const rt = getRuntime();
		const { ticket } = await seedAssignedTicket(rt);
		await utils.setJsonSetting('email', { notifications: false });

		await utils.notifyTicketEvent('closed', ticket, rt.env);
		expect(sent).toHaveLength(0);
	});

	it('notifies the customer + all assignees on close/reopen/archive (no actor)', async () => {
		const rt = getRuntime();
		const { ticket, customerEmail, agentA, agentB } = await seedAssignedTicket(rt);

		for (const event of ['closed', 'reopened', 'archived'] as const) {
			sent = [];
			await utils.notifyTicketEvent(event, ticket, rt.env);
			expect(recipients()).toEqual([agentA.email, agentB.email, customerEmail].sort());
		}
	});

	it('sends pre_delete + deleted to staff only, never the customer', async () => {
		const rt = getRuntime();
		const { ticket, customerEmail, agentA, agentB } = await seedAssignedTicket(rt);

		sent = [];
		await utils.notifyTicketEvent('pre_delete', ticket, rt.env, { daysLeft: 3 });
		expect(recipients()).toEqual([agentA.email, agentB.email].sort());
		expect(sent.some((s) => s.to === customerEmail)).toBe(false);
		expect(sent[0]!.subject).toContain('Scheduled for Deletion');
		expect(sent[0]!.body).toContain('3 days');

		sent = [];
		await utils.notifyTicketEvent('deleted', ticket, rt.env);
		expect(recipients()).toEqual([agentA.email, agentB.email].sort());
		expect(sent.some((s) => s.to === customerEmail)).toBe(false);
		expect(sent[0]!.subject).toContain('Deleted');
	});

	it('never throws when the customer lookup or transport fails', async () => {
		const rt = getRuntime();
		const { ticket } = await seedAssignedTicket(rt);
		(globalThis as any).sendCustomerEmail = vi.fn(async () => {
			throw new Error('smtp down');
		});

		await expect(utils.notifyTicketEvent('closed', ticket, rt.env)).resolves.toBeUndefined();
	});
});

describe('retention pre_delete notification', () => {
	const DAY_MS = 86_400_000;

	it('warns assigned staff when a purge is within 7 days', async () => {
		const rt = getRuntime();
		// seed inline (no getTicketById) so the meta-archived flag isn't masked by a stale ticket cache
		const customer = await seedCustomer(rt, { name: 'Cust', email: 'cust@example.com' });
		const a = await seedUser(rt, { username: 'agent_a', email: 'agent_a@example.com' });
		const b = await seedUser(rt, { username: 'agent_b', email: 'agent_b@example.com' });
		const agentA = { email: 'agent_a@example.com' };
		const agentB = { email: 'agent_b@example.com' };
		const customerEmail = 'cust@example.com';
		const ticket = await seedTicket(rt, {
			title: 'Broken Login',
			description: 'cannot sign in',
			customer_id: customer.id,
			assignee_ids: [a.id, b.id]
		});

		await utils.setJsonSetting('email', {});
		await utils.setJsonSetting('retention', { archive_days: 90, delete_days: 30 });

		// archived 25 days ago with a 30-day delete window -> ~5 days left
		const archivedAt = new Date(Date.now() - 25 * DAY_MS).toISOString();
		await utils.setTicketMeta(ticket.id, { archived: true, archived_at: archivedAt });

		const { runRetention } = await import('~/server/tasks/retention/cleanup');
		const result = await runRetention(rt.env);

		expect(result.deleted).toBe(0);
		expect(recipients()).toEqual([agentA.email, agentB.email].sort());
		expect(sent.some((s) => s.to === customerEmail)).toBe(false);
		expect(sent[0]!.subject).toContain('Scheduled for Deletion');

		// a second run inside the window must not re-warn (deduped via kv marker)
		sent = [];
		await runRetention(rt.env);
		expect(sent).toHaveLength(0);
	});
});
