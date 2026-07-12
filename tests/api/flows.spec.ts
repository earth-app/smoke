import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FlowCondition, Ticket, TicketThread } from '~/shared/types/ticket';
import { TicketPriority, TicketStatus, TicketVisibility } from '~/shared/types/ticket';
import { Permission, Role } from '~/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedAgent,
	seedCustomer,
	seedLabel,
	seedTicket,
	seedUser
} from './route-runtime';

// route-runtime registers the hub:* vi.mocks and imports #server-utils; grab the engine funcs
// via a dynamic import here (not a static one) so prettier's import reordering can't hoist the
// barrel above route-runtime and break the mocked binding resolution
let utils: typeof import('#server-utils');

beforeAll(async () => {
	utils = await import('#server-utils');
	// the routes reference the flows util as nitro auto-imports; wire them onto globalThis
	const flows = await import('~/server/utils/flows');
	for (const [key, value] of Object.entries(flows)) {
		(globalThis as Record<string, unknown>)[key] = value;
	}
});

const env = () => getRuntime().env;
// privileged reader so private tickets (source: 'team' defaults to private) are visible
const viewer = { id: 'sys', permissions: [Permission.ViewPrivateTickets] } as any;

async function readTicket(id: number): Promise<Ticket> {
	const thread = await utils.getTicketThread(id, env(), viewer);
	return thread.ticket;
}

async function readThread(id: number): Promise<TicketThread> {
	return await utils.getTicketThread(id, env(), viewer);
}

async function seedAdmin() {
	return await seedUser(getRuntime(), {
		username: 'admin',
		email: 'admin@example.com',
		role: Role.Admin
	});
}

async function seedPublicTicket() {
	const rt = getRuntime();
	const customer = await seedCustomer(rt, { name: 'Ann', email: 'ann@example.com' });
	const ticket = await seedTicket(rt, {
		title: 'Icon me',
		description: 'needs an icon',
		customer_id: customer.id,
		visibility: TicketVisibility.Public
	});
	return { rt, ticket };
}

describe('flow engine', () => {
	it('applies an action when a condition matches on ticket.created', async () => {
		await utils.createFlow({
			name: 'Urgent to High',
			trigger: 'ticket.created',
			match: 'all',
			conditions: [{ field: 'title', operator: 'contains', value: 'urgent' }],
			actions: [{ type: 'set_priority', value: TicketPriority.High }]
		});

		const ticket = await utils.createTicket(
			{ title: 'Urgent thing', description: 'x', source: 'team' },
			env()
		);
		const after = await readTicket(ticket.id);
		expect(after.priority).toBe(TicketPriority.High);
	});

	it('leaves the ticket unchanged when the condition does not match', async () => {
		await utils.createFlow({
			name: 'Urgent to High',
			trigger: 'ticket.created',
			match: 'all',
			conditions: [{ field: 'title', operator: 'contains', value: 'urgent' }],
			actions: [{ type: 'set_priority', value: TicketPriority.High }]
		});

		const ticket = await utils.createTicket(
			{ title: 'Normal request', description: 'x', source: 'team' },
			env()
		);
		const after = await readTicket(ticket.id);
		expect(after.priority).toBe(TicketPriority.None);
	});

	it('supports case-insensitive regex via the matches operator', async () => {
		await utils.createFlow({
			name: 'Auto Close Bugs',
			trigger: 'ticket.created',
			match: 'all',
			conditions: [{ field: 'title', operator: 'matches', value: '^bug:' }],
			actions: [{ type: 'set_status', value: TicketStatus.Closed }]
		});

		const ticket = await utils.createTicket(
			{ title: 'BUG: totally broken', description: 'x', source: 'team' },
			env()
		);
		const after = await readTicket(ticket.id);
		expect(after.status).toBe(TicketStatus.Closed);
	});

	it('treats an invalid regex pattern as no match', async () => {
		await utils.createFlow({
			name: 'Bad Pattern',
			trigger: 'ticket.created',
			match: 'all',
			conditions: [{ field: 'title', operator: 'matches', value: '([unclosed' }],
			actions: [{ type: 'set_priority', value: TicketPriority.Critical }]
		});

		const ticket = await utils.createTicket(
			{ title: '([unclosed literal', description: 'x', source: 'team' },
			env()
		);
		const after = await readTicket(ticket.id);
		expect(after.priority).toBe(TicketPriority.None);
	});

	it('match: all requires every condition to pass', async () => {
		await utils.createFlow({
			name: 'Both Words',
			trigger: 'ticket.created',
			match: 'all',
			conditions: [
				{ field: 'title', operator: 'contains', value: 'urgent' },
				{ field: 'title', operator: 'contains', value: 'refund' }
			],
			actions: [{ type: 'set_priority', value: TicketPriority.High }]
		});

		const ticket = await utils.createTicket(
			{ title: 'urgent thing', description: 'x', source: 'team' },
			env()
		);
		const after = await readTicket(ticket.id);
		expect(after.priority).toBe(TicketPriority.None);
	});

	it('match: any passes when one condition matches', async () => {
		await utils.createFlow({
			name: 'Either Word',
			trigger: 'ticket.created',
			match: 'any',
			conditions: [
				{ field: 'title', operator: 'contains', value: 'urgent' },
				{ field: 'title', operator: 'contains', value: 'refund' }
			],
			actions: [{ type: 'set_priority', value: TicketPriority.High }]
		});

		const ticket = await utils.createTicket(
			{ title: 'urgent thing', description: 'x', source: 'team' },
			env()
		);
		const after = await readTicket(ticket.id);
		expect(after.priority).toBe(TicketPriority.High);
	});

	it('a disabled flow does nothing', async () => {
		await utils.createFlow({
			name: 'Disabled',
			enabled: false,
			trigger: 'ticket.created',
			match: 'all',
			conditions: [{ field: 'title', operator: 'contains', value: 'urgent' }],
			actions: [{ type: 'set_priority', value: TicketPriority.High }]
		});

		const ticket = await utils.createTicket(
			{ title: 'urgent thing', description: 'x', source: 'team' },
			env()
		);
		const after = await readTicket(ticket.id);
		expect(after.priority).toBe(TicketPriority.None);
	});

	it('applies multiple actions and accumulates assignees/labels', async () => {
		const assignee = await seedAgent(getRuntime(), 'assignee_user', 'assignee@example.com');

		await utils.createFlow({
			name: 'Triage',
			trigger: 'ticket.created',
			match: 'all',
			conditions: [],
			actions: [
				{ type: 'assign', value: assignee.id },
				{ type: 'add_label', value: '5' },
				{ type: 'set_color', value: '#123456' }
			]
		});

		const ticket = await utils.createTicket({ title: 'anything', description: 'x' }, env());
		const after = await readTicket(ticket.id);
		expect(after.assignees.some((a) => a.id === assignee.id)).toBe(true);
		expect(after.labels).toContain(5);
		expect(after.color).toBe('#123456');
	});

	it('the skipFlows guard prevents infinite recursion on ticket.updated', async () => {
		await utils.createFlow({
			name: 'Always Color',
			trigger: 'ticket.updated',
			match: 'all',
			conditions: [],
			actions: [{ type: 'set_color', value: '#abcdef' }]
		});

		// created fires first; the flow only listens for updated, so it should not run yet
		const ticket = await utils.createTicket({ title: 'x', description: 'y' }, env());
		expect((await readTicket(ticket.id)).color).toBeNull();

		// this patch fires ticket.updated -> the flow patches again with skipFlows, so no loop
		await utils.patchTicket(ticket.id, { title: 'updated title' }, env());
		const after = await readTicket(ticket.id);
		expect(after.color).toBe('#abcdef');
		expect(after.title).toBe('updated title');
	});

	it('evaluates customer_email conditions on a directly-fired ticket.message event', async () => {
		await utils.createFlow({
			name: 'VIP Escalation',
			trigger: 'ticket.message',
			match: 'all',
			conditions: [{ field: 'customer_email', operator: 'equals', value: 'vip@example.com' }],
			actions: [{ type: 'set_priority', value: TicketPriority.Critical }]
		});

		const ticket = await utils.createTicket(
			{ title: 'hello', description: 'y', source: 'team' },
			env()
		);
		expect((await readTicket(ticket.id)).priority).toBe(TicketPriority.None);

		const snapshot = await readTicket(ticket.id);
		await utils.runTicketFlows(
			{ trigger: 'ticket.message', ticket: snapshot, customer_email: 'vip@example.com' },
			env()
		);
		const after = await readTicket(ticket.id);
		expect(after.priority).toBe(TicketPriority.Critical);
	});
});

describe('POST /api/flows', () => {
	it('rejects a caller without ManageSettings', async () => {
		const agent = await seedAgent(getRuntime());
		const handler = await importRoute('~/server/api/flows/index.post');
		mockBody({
			name: 'A',
			trigger: 'ticket.created',
			actions: [{ type: 'set_priority', value: 'high' }]
		});
		await expect(handler(eventFor(env(), agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('creates flows with incrementing ids and defaults', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/flows/index.post');

		mockBody({
			name: 'First',
			trigger: 'ticket.created',
			actions: [{ type: 'set_priority', value: 'high' }]
		});
		const first = (await post(eventFor(env(), admin.sessionToken))) as any;
		expect(first.id).toBe(1);
		expect(first.enabled).toBe(true);
		expect(first.match).toBe('all');

		mockBody({
			name: 'Second',
			trigger: 'ticket.updated',
			match: 'any',
			conditions: [{ field: 'title', operator: 'contains', value: 'x' }],
			actions: [{ type: 'archive', value: '' }]
		});
		const second = (await post(eventFor(env(), admin.sessionToken))) as any;
		expect(second.id).toBe(2);
		expect(second.match).toBe('any');
	});
});

describe('GET /api/flows', () => {
	it('rejects a caller without ManageSettings', async () => {
		const agent = await seedAgent(getRuntime());
		const get = await importRoute('~/server/api/flows/index.get');
		await expect(get(eventFor(env(), agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('lists flows for an admin', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/flows/index.post');
		mockBody({
			name: 'Listed',
			trigger: 'ticket.created',
			actions: [{ type: 'set_priority', value: 'high' }]
		});
		await post(eventFor(env(), admin.sessionToken));

		const get = await importRoute('~/server/api/flows/index.get');
		const list = (await get(eventFor(env(), admin.sessionToken))) as any[];
		expect(list).toHaveLength(1);
		expect(list[0].name).toBe('Listed');
	});
});

describe('PATCH /api/flows/[id]', () => {
	it('updates a flow name and enabled state', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/flows/index.post');
		mockBody({
			name: 'Before',
			trigger: 'ticket.created',
			actions: [{ type: 'set_priority', value: 'high' }]
		});
		await post(eventFor(env(), admin.sessionToken));

		const patch = await importRoute('~/server/api/flows/[id]/index.patch');
		mockParams({ id: 1 });
		mockBody({ name: 'After', enabled: false });
		const updated = (await patch(eventFor(env(), admin.sessionToken))) as any;
		expect(updated.name).toBe('After');
		expect(updated.enabled).toBe(false);
	});

	it('rejects a caller without ManageSettings', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/flows/index.post');
		mockBody({
			name: 'Before',
			trigger: 'ticket.created',
			actions: [{ type: 'set_priority', value: 'high' }]
		});
		await post(eventFor(env(), admin.sessionToken));

		const agent = await seedAgent(getRuntime());
		const patch = await importRoute('~/server/api/flows/[id]/index.patch');
		mockParams({ id: 1 });
		mockBody({ name: 'Nope' });
		await expect(patch(eventFor(env(), agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('returns 404 for a missing flow', async () => {
		const admin = await seedAdmin();
		const patch = await importRoute('~/server/api/flows/[id]/index.patch');
		mockParams({ id: 999 });
		mockBody({ name: 'Ghost' });
		await expect(patch(eventFor(env(), admin.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});

describe('DELETE /api/flows/[id]', () => {
	it('deletes a flow', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/flows/index.post');
		mockBody({
			name: 'Doomed',
			trigger: 'ticket.created',
			actions: [{ type: 'set_priority', value: 'high' }]
		});
		await post(eventFor(env(), admin.sessionToken));

		const del = await importRoute('~/server/api/flows/[id]/index.delete');
		mockParams({ id: 1 });
		await del(eventFor(env(), admin.sessionToken));

		const get = await importRoute('~/server/api/flows/index.get');
		const list = (await get(eventFor(env(), admin.sessionToken))) as any[];
		expect(list).toHaveLength(0);
	});

	it('returns 404 for a missing flow', async () => {
		const admin = await seedAdmin();
		const del = await importRoute('~/server/api/flows/[id]/index.delete');
		mockParams({ id: 999 });
		await expect(del(eventFor(env(), admin.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});

describe('flow operators', () => {
	it('starts_with matches a title prefix', async () => {
		await utils.createFlow({
			name: 'Bug Prefix',
			trigger: 'ticket.created',
			conditions: [{ field: 'title', operator: 'starts_with', value: 'bug:' }],
			actions: [{ type: 'set_status', value: TicketStatus.Closed }]
		});

		const yes = await utils.createTicket(
			{ title: 'BUG: broken', description: 'x', source: 'team' },
			env()
		);
		const no = await utils.createTicket(
			{ title: 'feature: shiny', description: 'x', source: 'team' },
			env()
		);
		expect((await readTicket(yes.id)).status).toBe(TicketStatus.Closed);
		expect((await readTicket(no.id)).status).not.toBe(TicketStatus.Closed);
	});

	it('ends_with matches a title suffix', async () => {
		await utils.createFlow({
			name: 'Resolved Suffix',
			trigger: 'ticket.created',
			conditions: [{ field: 'title', operator: 'ends_with', value: '(resolved)' }],
			actions: [{ type: 'set_priority', value: TicketPriority.Low }]
		});

		const yes = await utils.createTicket(
			{ title: 'Login issue (resolved)', description: 'x', source: 'team' },
			env()
		);
		const no = await utils.createTicket(
			{ title: 'Login issue', description: 'x', source: 'team' },
			env()
		);
		expect((await readTicket(yes.id)).priority).toBe(TicketPriority.Low);
		expect((await readTicket(no.id)).priority).toBe(TicketPriority.None);
	});

	it('gt/lt compare enum fields by their ordinal (priority gt/lt)', async () => {
		await utils.createFlow({
			name: 'Above Medium',
			trigger: 'ticket.created',
			conditions: [{ field: 'priority', operator: 'gt', value: 'medium' }],
			actions: [{ type: 'set_color', value: '#ff0000' }]
		});
		await utils.createFlow({
			name: 'Below High',
			trigger: 'ticket.created',
			conditions: [{ field: 'priority', operator: 'lt', value: 'high' }],
			actions: [{ type: 'set_color', value: '#00ff00' }]
		});

		const high = await utils.createTicket(
			{ title: 'a', description: 'x', priority: TicketPriority.High, source: 'team' },
			env()
		);
		const low = await utils.createTicket(
			{ title: 'b', description: 'x', priority: TicketPriority.Low, source: 'team' },
			env()
		);

		// high > medium (not < high) -> red only
		expect((await readTicket(high.id)).color).toBe('#ff0000');
		// low < high (not > medium) -> green only
		expect((await readTicket(low.id)).color).toBe('#00ff00');
	});

	it('gt parses plain numbers for non-enum fields', async () => {
		await utils.createFlow({
			name: 'Numeric Title',
			trigger: 'ticket.created',
			conditions: [{ field: 'title', operator: 'gt', value: '3' }],
			actions: [{ type: 'set_priority', value: TicketPriority.High }]
		});

		const yes = await utils.createTicket({ title: '5', description: 'x', source: 'team' }, env());
		const no = await utils.createTicket({ title: '2', description: 'x', source: 'team' }, env());
		expect((await readTicket(yes.id)).priority).toBe(TicketPriority.High);
		expect((await readTicket(no.id)).priority).toBe(TicketPriority.None);
	});

	it('in_list matches any comma item case-insensitively', async () => {
		await utils.createFlow({
			name: 'Hot Priorities',
			trigger: 'ticket.created',
			conditions: [{ field: 'priority', operator: 'in_list', value: 'HIGH, Critical' }],
			actions: [{ type: 'set_status', value: TicketStatus.Closed }]
		});

		const yes = await utils.createTicket(
			{ title: 'a', description: 'x', priority: TicketPriority.Critical, source: 'team' },
			env()
		);
		const no = await utils.createTicket(
			{ title: 'b', description: 'x', priority: TicketPriority.Low, source: 'team' },
			env()
		);
		expect((await readTicket(yes.id)).status).toBe(TicketStatus.Closed);
		expect((await readTicket(no.id)).status).not.toBe(TicketStatus.Closed);
	});
});

describe('in_list validation', () => {
	it('drops a malformed in_list condition (fewer than 2 items) but keeps the rest', async () => {
		const flow = await utils.createFlow({
			name: 'Mixed',
			trigger: 'ticket.created',
			conditions: [
				{ field: 'title', operator: 'contains', value: 'x' },
				{ field: 'priority', operator: 'in_list', value: 'high' }
			],
			actions: [{ type: 'set_priority', value: TicketPriority.High }]
		});

		const stored = await utils.getFlow(flow.id);
		expect(stored?.conditions).toHaveLength(1);
		expect(stored?.conditions[0]).toMatchObject({ field: 'title', operator: 'contains' });
	});

	it('keeps a valid in_list condition (2-20 items)', async () => {
		const flow = await utils.createFlow({
			name: 'Valid List',
			trigger: 'ticket.created',
			conditions: [{ field: 'priority', operator: 'in_list', value: 'high, critical' }],
			actions: [{ type: 'set_priority', value: TicketPriority.High }]
		});

		const stored = await utils.getFlow(flow.id);
		expect(stored?.conditions).toHaveLength(1);
		expect(stored?.conditions[0]?.operator).toBe('in_list');
	});
});

describe('lock_thread action', () => {
	it('locks a ticket when the flow matches', async () => {
		await utils.createFlow({
			name: 'Lock Closed',
			trigger: 'ticket.created',
			conditions: [{ field: 'title', operator: 'contains', value: 'spam' }],
			actions: [{ type: 'lock_thread', value: '' }]
		});

		const ticket = await utils.createTicket(
			{ title: 'spam report', description: 'x', source: 'team' },
			env()
		);
		expect((await readTicket(ticket.id)).locked).toBe(true);
	});

	it("honors an explicit 'false' value (does not lock)", async () => {
		await utils.createFlow({
			name: 'Unlock',
			trigger: 'ticket.created',
			conditions: [],
			actions: [{ type: 'lock_thread', value: 'false' }]
		});

		const ticket = await utils.createTicket(
			{ title: 'anything', description: 'x', source: 'team' },
			env()
		);
		expect((await readTicket(ticket.id)).locked ?? false).toBe(false);
	});
});

describe('message actions', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('reply_in_thread auto-send posts a message and mirrors it to the customer', async () => {
		const spy = vi.fn().mockResolvedValue(true);
		const original = (globalThis as any).sendTicketEmailReply;
		(globalThis as any).sendTicketEmailReply = spy;

		try {
			await utils.createFlow({
				name: 'Auto Reply',
				trigger: 'ticket.created',
				conditions: [],
				actions: [
					{
						type: 'reply_in_thread',
						value: 'Thanks for reaching out about "{{ticket.title}}".',
						auto_send: true,
						identity: 'automation'
					}
				]
			});

			// public ticket so the customer-visible reply reads back non-private
			const ticket = await utils.createTicket(
				{ title: 'Broken login', description: 'x', source: 'team', private: false },
				env()
			);

			const thread = await readThread(ticket.id);
			const posted = thread.messages.find((m) =>
				m.message.includes('Thanks for reaching out about "Broken login".')
			);
			expect(posted).toBeTruthy();
			expect(posted?.private).toBe(false);
			expect(posted?.sender).toMatchObject({ id: 'automation', username: 'automation' });
			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy.mock.calls[0]?.[0]).toBe(ticket.id);
		} finally {
			(globalThis as any).sendTicketEmailReply = original;
		}
	});

	it('reply_in_thread draft posts a private internal note and does not email', async () => {
		const spy = vi.fn().mockResolvedValue(true);
		const original = (globalThis as any).sendTicketEmailReply;
		(globalThis as any).sendTicketEmailReply = spy;

		try {
			await utils.createFlow({
				name: 'Draft Reply',
				trigger: 'ticket.created',
				conditions: [],
				actions: [{ type: 'reply_in_thread', value: 'internal draft note', auto_send: false }]
			});

			const ticket = await utils.createTicket(
				{ title: 'anything', description: 'x', source: 'team' },
				env()
			);

			const thread = await readThread(ticket.id);
			const note = thread.messages.find((m) => m.message === 'internal draft note');
			expect(note).toBeTruthy();
			expect(note?.private).toBe(true);
			expect(spy).not.toHaveBeenCalled();
		} finally {
			(globalThis as any).sendTicketEmailReply = original;
		}
	});

	it('a reply_in_thread flow on ticket.message does not loop', async () => {
		await utils.createFlow({
			name: 'Ack Message',
			trigger: 'ticket.message',
			conditions: [],
			actions: [{ type: 'reply_in_thread', value: 'auto ack', auto_send: false }]
		});

		const customer = await seedCustomer(getRuntime(), {
			name: 'Cust',
			email: 'cust@example.com'
		});
		const ticket = await utils.createTicket(
			{ title: 'help', description: 'x', customer_id: customer.id, source: 'team' },
			env()
		);

		await utils.addTicketMessage(
			ticket.id,
			{
				message: 'a customer question',
				sender: { kind: 'customer', id: customer.id, email: 'cust@example.com' }
			},
			env()
		);

		const thread = await readThread(ticket.id);
		// exactly the customer message + one auto ack; the ack's own ticket.message is suppressed
		const acks = thread.messages.filter((m) => m.message === 'auto ack');
		expect(acks).toHaveLength(1);
		expect(thread.messages).toHaveLength(2);
	});
});

describe('customer triggers', () => {
	it('runs customer.created flows without a ticket and never throws', async () => {
		const addSpy = vi.spyOn(utils, 'addTicketMessage');
		const emailSpy = vi.fn().mockResolvedValue(true);
		const originalEmail = (globalThis as any).sendTicketEmailReply;
		(globalThis as any).sendTicketEmailReply = emailSpy;

		try {
			await utils.createFlow({
				name: 'Welcome',
				trigger: 'customer.created',
				conditions: [],
				actions: [{ type: 'email_customer', value: 'welcome {{customer.name}}', auto_send: true }]
			});

			await expect(
				utils.runTicketFlows(
					{
						trigger: 'customer.created',
						customer: { id: 1, email: 'new@example.com', name: 'New' }
					},
					env()
				)
			).resolves.toBeUndefined();

			// no ticket -> nothing posted or emailed, but the flow was evaluated without crashing
			expect(addSpy).not.toHaveBeenCalled();
			expect(emailSpy).not.toHaveBeenCalled();
		} finally {
			(globalThis as any).sendTicketEmailReply = originalEmail;
			addSpy.mockRestore();
		}
	});

	it('customer.added runs message actions against the attached ticket', async () => {
		const spy = vi.fn().mockResolvedValue(true);
		const original = (globalThis as any).sendTicketEmailReply;
		(globalThis as any).sendTicketEmailReply = spy;

		try {
			await utils.createFlow({
				name: 'Greet On Attach',
				trigger: 'customer.added',
				conditions: [],
				actions: [{ type: 'reply_in_thread', value: 'customer attached', auto_send: false }]
			});

			const ticket = await utils.createTicket(
				{ title: 'attach me', description: 'x', source: 'team' },
				env()
			);
			const snapshot = await readTicket(ticket.id);
			await utils.runTicketFlows(
				{
					trigger: 'customer.added',
					ticket: snapshot,
					customer: { id: 7, email: 'attached@example.com', name: 'Attached' }
				},
				env()
			);

			const thread = await readThread(ticket.id);
			const note = thread.messages.find((m) => m.message === 'customer attached');
			expect(note).toBeTruthy();
			expect(note?.private).toBe(true);
		} finally {
			(globalThis as any).sendTicketEmailReply = original;
		}
	});
});

describe('set_icon action', () => {
	it('sets ticket.icon when the flow matches', async () => {
		await utils.createFlow({
			name: 'Bug Icon',
			trigger: 'ticket.created',
			conditions: [{ field: 'title', operator: 'contains', value: 'bug' }],
			actions: [{ type: 'set_icon', value: 'mdi:bug' }]
		});

		const yes = await utils.createTicket(
			{ title: 'bug report', description: 'x', source: 'team' },
			env()
		);
		const no = await utils.createTicket(
			{ title: 'feature request', description: 'x', source: 'team' },
			env()
		);

		expect((await readTicket(yes.id)).icon).toBe('mdi:bug');
		expect((await readTicket(no.id)).icon ?? null).toBeNull();
	});

	it('clears the icon with an empty value', async () => {
		await utils.createFlow({
			name: 'Clear Icon',
			trigger: 'ticket.created',
			conditions: [],
			actions: [{ type: 'set_icon', value: '' }]
		});

		// created with an initial icon; the flow's empty set_icon clears it back to null
		const ticket = await utils.createTicket(
			{ title: 'anything', description: 'x', source: 'team', icon: 'mdi:star-outline' },
			env()
		);

		expect((await readTicket(ticket.id)).icon ?? null).toBeNull();
	});
});

describe('label triggers', () => {
	it('label.added fires a reply action and substitutes {{label.name}}', async () => {
		await utils.createFlow({
			name: 'Note On Label',
			trigger: 'label.added',
			conditions: [],
			actions: [{ type: 'reply_in_thread', value: 'labeled: {{label.name}}', auto_send: false }]
		});

		const label = await seedLabel(getRuntime(), 'Billing', '#f97316');
		const ticket = await utils.createTicket(
			{ title: 'help', description: 'x', source: 'team' },
			env()
		);

		// adding the label via patchTicket diffs the label set and fires label.added
		await utils.patchTicket(ticket.id, { labels: [label.id] }, env());

		const thread = await readThread(ticket.id);
		const note = thread.messages.find((m) => m.message === 'labeled: Billing');
		expect(note).toBeTruthy();
		expect(note?.private).toBe(true);
	});

	it('runs a label.created flow without a ticket and never throws', async () => {
		const addSpy = vi.spyOn(utils, 'addTicketMessage');
		const emailSpy = vi.fn().mockResolvedValue(true);
		const originalEmail = (globalThis as any).sendTicketEmailReply;
		(globalThis as any).sendTicketEmailReply = emailSpy;

		try {
			await utils.createFlow({
				name: 'Label Created',
				trigger: 'label.created',
				conditions: [],
				actions: [
					{ type: 'email_customer', value: 'label {{label.name}} created', auto_send: true }
				]
			});

			await expect(
				utils.runTicketFlows(
					{
						trigger: 'label.created',
						label: { id: 1, name: 'Urgent', color: '#ff0000' }
					},
					env()
				)
			).resolves.toBeUndefined();

			// no ticket -> nothing posted or mirrored, but the flow was evaluated without crashing
			expect(addSpy).not.toHaveBeenCalled();
			expect(emailSpy).not.toHaveBeenCalled();
		} finally {
			(globalThis as any).sendTicketEmailReply = originalEmail;
			addSpy.mockRestore();
		}
	});
});

describe('assignee.added flow trigger (patchTicket diff)', () => {
	it('runs an assignee.added flow when an assignee is attached', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');

		const agent = await seedUser(rt, {
			username: 'assignee_one',
			email: 'assignee1@example.com',
			role: Role.Agent
		});

		// a flow that bumps priority to critical whenever someone is assigned
		await utils.createFlow({
			name: 'Escalate on assign',
			trigger: 'assignee.added',
			actions: [{ type: 'set_priority', value: TicketPriority.Critical }]
		});

		await utils.patchTicket(ticket.id, { assignee_ids: [agent.id] }, rt.env);

		const fetched = await utils.getTicketById(ticket.id, rt.env);
		expect(fetched?.priority).toBe(TicketPriority.Critical);
		expect(fetched?.assignees.map((a) => a.id)).toContain(agent.id);
	});

	it('does not fire assignee.added when assignees are unchanged', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');

		await utils.createFlow({
			name: 'Escalate on assign',
			trigger: 'assignee.added',
			actions: [{ type: 'set_priority', value: TicketPriority.Critical }]
		});

		// a non-assignee patch must not trip the assignee.added flow
		await utils.patchTicket(ticket.id, { title: 'Renamed' }, rt.env);
		const fetched = await utils.getTicketById(ticket.id, rt.env);
		expect(fetched?.priority).not.toBe(TicketPriority.Critical);
	});
});

describe('nested conditions', () => {
	const leaf = (
		field: FlowCondition['field'],
		operator: FlowCondition['operator'],
		value: string
	): FlowCondition => ({ field, operator, value });

	it('a AND (b OR c): matches only when a holds and one of b/c holds', async () => {
		await utils.createFlow({
			name: 'And Or',
			trigger: 'ticket.created',
			condition_tree: {
				kind: 'group',
				match: 'all',
				conditions: [
					leaf('title', 'contains', 'refund'),
					{
						kind: 'group',
						match: 'any',
						conditions: [leaf('title', 'contains', 'urgent'), leaf('title', 'contains', 'vip')]
					}
				]
			},
			actions: [{ type: 'set_color', value: '#111111' }]
		});

		const both = await utils.createTicket(
			{ title: 'refund urgent please', description: 'x', source: 'team' },
			env()
		);
		const onlyA = await utils.createTicket(
			{ title: 'refund only', description: 'x', source: 'team' },
			env()
		);
		const onlyBc = await utils.createTicket(
			{ title: 'urgent vip', description: 'x', source: 'team' },
			env()
		);

		expect((await readTicket(both.id)).color).toBe('#111111');
		expect((await readTicket(onlyA.id)).color ?? null).toBeNull();
		expect((await readTicket(onlyBc.id)).color ?? null).toBeNull();
	});

	it('(a AND b) OR (c AND d): either complete pair triggers the flow', async () => {
		await utils.createFlow({
			name: 'Or of Ands',
			trigger: 'ticket.created',
			condition_tree: {
				kind: 'group',
				match: 'any',
				conditions: [
					{
						kind: 'group',
						match: 'all',
						conditions: [leaf('title', 'contains', 'login'), leaf('title', 'contains', 'error')]
					},
					{
						kind: 'group',
						match: 'all',
						conditions: [leaf('title', 'contains', 'payment'), leaf('title', 'contains', 'failed')]
					}
				]
			},
			actions: [{ type: 'set_color', value: '#222222' }]
		});

		const first = await utils.createTicket(
			{ title: 'login error on submit', description: 'x', source: 'team' },
			env()
		);
		const second = await utils.createTicket(
			{ title: 'payment failed at checkout', description: 'x', source: 'team' },
			env()
		);
		const neither = await utils.createTicket(
			{ title: 'login and payment questions', description: 'x', source: 'team' },
			env()
		);

		expect((await readTicket(first.id)).color).toBe('#222222');
		expect((await readTicket(second.id)).color).toBe('#222222');
		expect((await readTicket(neither.id)).color ?? null).toBeNull();
	});

	it('an empty root group matches every event (always runs)', async () => {
		await utils.createFlow({
			name: 'Always',
			trigger: 'ticket.created',
			condition_tree: { kind: 'group', match: 'all', conditions: [] },
			actions: [{ type: 'set_color', value: '#333333' }]
		});

		const ticket = await utils.createTicket(
			{ title: 'anything at all', description: 'x', source: 'team' },
			env()
		);
		expect((await readTicket(ticket.id)).color).toBe('#333333');
	});

	it('evaluates a deeply nested tree (all > any > all > leaf)', async () => {
		await utils.createFlow({
			name: 'Deep',
			trigger: 'ticket.created',
			condition_tree: {
				kind: 'group',
				match: 'all',
				conditions: [
					{
						kind: 'group',
						match: 'any',
						conditions: [
							{
								kind: 'group',
								match: 'all',
								conditions: [leaf('title', 'contains', 'deep')]
							}
						]
					}
				]
			},
			actions: [{ type: 'set_color', value: '#444444' }]
		});

		const yes = await utils.createTicket(
			{ title: 'a deep dive', description: 'x', source: 'team' },
			env()
		);
		const no = await utils.createTicket(
			{ title: 'shallow water', description: 'x', source: 'team' },
			env()
		);
		expect((await readTicket(yes.id)).color).toBe('#444444');
		expect((await readTicket(no.id)).color ?? null).toBeNull();
	});

	it('a flow with no condition_tree still uses the flat conditions (back-compat)', async () => {
		const flow = await utils.createFlow({
			name: 'Flat Any',
			trigger: 'ticket.created',
			match: 'any',
			conditions: [
				{ field: 'title', operator: 'contains', value: 'alpha' },
				{ field: 'title', operator: 'contains', value: 'beta' }
			],
			actions: [{ type: 'set_color', value: '#555555' }]
		});

		const stored = await utils.getFlow(flow.id);
		expect(stored?.condition_tree).toBeUndefined();

		const yes = await utils.createTicket(
			{ title: 'has beta only', description: 'x', source: 'team' },
			env()
		);
		const no = await utils.createTicket(
			{ title: 'gamma only', description: 'x', source: 'team' },
			env()
		);
		expect((await readTicket(yes.id)).color).toBe('#555555');
		expect((await readTicket(no.id)).color ?? null).toBeNull();
	});

	it('normalizes a stored tree: drops malformed leaves, prunes empty groups, keeps valid in_list', async () => {
		const flow = await utils.createFlow({
			name: 'Messy Tree',
			trigger: 'ticket.created',
			condition_tree: {
				kind: 'group',
				match: 'all',
				conditions: [
					leaf('title', 'contains', 'ok'),
					// malformed leaf (unknown field) -> dropped
					{ field: 'nonsense', operator: 'contains', value: 'x' },
					// in_list with a single item -> dropped
					leaf('priority', 'in_list', 'high'),
					// empty nested group -> pruned
					{ kind: 'group', match: 'any', conditions: [] },
					// nested group with a valid 2-item in_list -> kept
					{
						kind: 'group',
						match: 'any',
						conditions: [leaf('priority', 'in_list', 'high, critical')]
					}
				]
			} as any,
			actions: [{ type: 'set_color', value: '#666666' }]
		});

		const stored = await utils.getFlow(flow.id);
		const tree = stored?.condition_tree;
		expect(tree?.match).toBe('all');
		// the ok leaf + the surviving nested group; malformed/short leaves + the empty group are gone
		expect(tree?.conditions).toHaveLength(2);
		const kinds = (tree?.conditions ?? []).map((n) => (n as { kind?: string }).kind);
		expect(kinds).toContain('condition');
		expect(kinds).toContain('group');
	});
});
