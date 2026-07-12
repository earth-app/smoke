import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus, TicketVisibility } from '~/shared/types/ticket';
import { Role } from '~/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockCookie,
	mockParams,
	mockQuery,
	seedCustomer,
	seedManager,
	seedTicket,
	seedUser
} from './route-runtime';

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

describe('ticket multi-project foundation', () => {
	it('creates a ticket with project_ids and hydrates project_id to the first', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const t = await utils.createTicket(
			{ title: 'Multi', description: 'two projects', project_ids: [7, 3] },
			runtime.env
		);
		expect(t.project_ids).toEqual([7, 3]);
		expect(t.project_id).toBe(7);

		const fetched = await utils.getTicketById(t.id, runtime.env);
		expect(fetched?.project_ids).toEqual([7, 3]);
		expect(fetched?.project_id).toBe(7);
	});

	it('patches project_ids and replaces the whole set', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const t = await utils.createTicket(
			{ title: 'Replace', description: 'x', project_ids: [1, 2] },
			runtime.env
		);
		const patched = await utils.patchTicket(t.id, { project_ids: [4, 5, 6] }, runtime.env);
		expect(patched.project_ids).toEqual([4, 5, 6]);
		expect(patched.project_id).toBe(4);

		const fetched = await utils.getTicketById(t.id, runtime.env);
		expect(fetched?.project_ids).toEqual([4, 5, 6]);
		expect(fetched?.project_id).toBe(4);
	});

	it('hydrates a legacy single project_id create into project_ids', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const t = await utils.createTicket(
			{ title: 'Legacy', description: 'y', project_id: 9 },
			runtime.env
		);
		expect(t.project_ids).toEqual([9]);
		expect(t.project_id).toBe(9);
	});

	it('clears projects when patching project_ids to an empty array', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const t = await utils.createTicket(
			{ title: 'Clear', description: 'z', project_ids: [1, 2] },
			runtime.env
		);
		const patched = await utils.patchTicket(t.id, { project_ids: [] }, runtime.env);
		expect(patched.project_ids).toEqual([]);
		expect(patched.project_id).toBeNull();

		const fetched = await utils.getTicketById(t.id, runtime.env);
		expect(fetched?.project_ids).toEqual([]);
		expect(fetched?.project_id).toBeNull();
	});

	it('dedupes and drops non-positive project ids on create', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const t = await utils.createTicket(
			{ title: 'Dedupe', description: 'q', project_ids: [3, 3, 0, -1, 5] },
			runtime.env
		);
		expect(t.project_ids).toEqual([3, 5]);
		expect(t.project_id).toBe(3);
	});
});

describe('ticket icon persistence', () => {
	it('round-trips an icon through create + hydrate', async () => {
		const rt = getRuntime();
		const utils = await import('#server-utils');
		const created = await utils.createTicket(
			{ title: 'Bug', description: 'x', customer_id: 0, icon: 'mdi:bug' },
			rt.env
		);
		expect(created.icon).toBe('mdi:bug');

		const fetched = await utils.getTicketById(created.id, rt.env);
		expect(fetched?.icon).toBe('mdi:bug');
	});

	it('patches and clears the icon', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');

		let updated = await utils.patchTicket(ticket.id, { icon: 'mdi:lightbulb-on-outline' }, rt.env);
		expect(updated.icon).toBe('mdi:lightbulb-on-outline');

		updated = await utils.patchTicket(ticket.id, { icon: null }, rt.env);
		expect(updated.icon).toBeNull();
	});
});

describe('addTicketMessage sender + private handling', () => {
	it('keeps a fully-formed team sender verbatim (not re-hydrated to the real user)', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		const author = await seedUser(rt, {
			username: 'real_agent',
			email: 'real@example.com',
			role: Role.Agent
		});

		const message = await utils.addTicketMessage(
			ticket.id,
			{
				message: 'from the team',
				sender: { kind: 'user', id: author.id, username: 'team', name: 'Team' }
			},
			rt.env
		);
		expect(message.sender.kind).toBe('user');
		expect((message.sender as any).username).toBe('team');
		expect((message.sender as any).name).toBe('Team');
		expect((message.sender as any).avatar_url).toBeUndefined();
	});

	it('backfills a bare user id sender from the db', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		const author = await seedUser(rt, {
			username: 'filled_agent',
			email: 'filled@example.com',
			role: Role.Manager
		});

		const message = await utils.addTicketMessage(
			ticket.id,
			{ message: 'hydrate me', sender: { kind: 'user', id: author.id } as any },
			rt.env
		);
		expect((message.sender as any).username).toBe('filled_agent');
		expect((message.sender as any).role).toBe(Role.Manager);
	});

	it('honors an explicit private override on a public ticket', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');

		const message = await utils.addTicketMessage(
			ticket.id,
			{
				message: 'internal note',
				sender: { kind: 'user', id: 'automation', username: 'automation', name: 'Automation' },
				private: true
			},
			rt.env
		);
		expect(message.private).toBe(true);
	});
});

describe('PATCH /api/tickets/[id] archived read-only', () => {
	async function seedArchivedTicket() {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		await utils.patchTicket(ticket.id, { archived: true }, rt.env);
		return { rt, ticket };
	}

	it('rejects editing an archived ticket', async () => {
		const { rt, ticket } = await seedArchivedTicket();
		const manager = await seedManager(rt);

		const handler = await importRoute('~/server/api/tickets/[id]/index.patch');
		mockParams({ id: ticket.id });
		mockBody({ title: 'Renamed while archived' });
		await expect(handler(eventFor(rt.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 423
		});
	});

	it('rejects an unarchive combined with another edit', async () => {
		const { rt, ticket } = await seedArchivedTicket();
		const manager = await seedManager(rt);

		const handler = await importRoute('~/server/api/tickets/[id]/index.patch');
		mockParams({ id: ticket.id });
		mockBody({ archived: false, title: 'Sneaky edit' });
		await expect(handler(eventFor(rt.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 423
		});
	});

	it('allows an unarchive-only body and clears archived', async () => {
		const { rt, ticket } = await seedArchivedTicket();
		const manager = await seedManager(rt);

		const handler = await importRoute('~/server/api/tickets/[id]/index.patch');
		mockParams({ id: ticket.id });
		mockBody({ archived: false });
		const result = (await handler(eventFor(rt.env, manager.sessionToken))) as any;
		expect(result.archived).toBe(false);
		expect(result.archived_at).toBeNull();

		const utils = await import('#server-utils');
		const meta = await utils.getTicketMeta(ticket.id);
		expect(meta.archived).toBe(false);
	});

	it('allows a normal edit once the ticket is not archived', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const manager = await seedManager(rt);

		const handler = await importRoute('~/server/api/tickets/[id]/index.patch');
		mockParams({ id: ticket.id });
		mockBody({ title: 'Edited while active' });
		const result = (await handler(eventFor(rt.env, manager.sessionToken))) as any;
		expect(result.title).toBe('Edited while active');
	});
});

describe('ticket model foundation', () => {
	it('opens a customer-less internal ticket', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const t = await utils.createTicket(
			{ title: 'Internal bug', description: 'track this' },
			runtime.env
		);
		expect(t.customer_id).toBe(0);
	});

	it('derives the private column from visibility and round-trips meta', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const pub = await utils.createTicket(
			{ title: 'P', description: 'x', visibility: TicketVisibility.Public, color: '#ff0000' },
			runtime.env
		);
		expect(pub.visibility).toBe('public');
		expect(pub.private).toBe(false);
		expect(pub.color).toBe('#ff0000');

		const priv = await utils.createTicket(
			{ title: 'Q', description: 'y', visibility: TicketVisibility.Private },
			runtime.env
		);
		expect(priv.visibility).toBe('private');
		expect(priv.private).toBe(true);
	});

	it('applies the per-source default visibility and syncs the private column on patch', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		// a 'team'-sourced ticket takes the configured team default (private out of the box)
		const t = await utils.createTicket(
			{ title: 'D', description: 'z', source: 'team' },
			runtime.env
		);
		expect(t.visibility).toBe('private');

		const patched = await utils.patchTicket(
			t.id,
			{ visibility: TicketVisibility.Public, deadline: '2026-08-01T00:00:00.000Z' },
			runtime.env
		);
		expect(patched.visibility).toBe('public');
		expect(patched.private).toBe(false);
		expect(patched.deadline?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
	});

	it('gates visibility for anonymous, staff, and assignees', async () => {
		const utils = await import('#server-utils');
		const base = {
			id: 1,
			title: '',
			description: '',
			status: 'open',
			priority: 'none',
			labels: [],
			customer_id: 0,
			assignees: [],
			created_at: new Date(),
			updated_at: new Date()
		} as any;
		const staff = { id: 'u1', permissions: [] } as any;

		expect(
			utils.canViewPrivateTicket(null, {
				...base,
				private: false,
				visibility: TicketVisibility.Public
			})
		).toBe(true);
		expect(
			utils.canViewPrivateTicket(null, {
				...base,
				private: true,
				visibility: TicketVisibility.Internal
			})
		).toBe(false);
		expect(
			utils.canViewPrivateTicket(staff, {
				...base,
				private: true,
				visibility: TicketVisibility.Internal
			})
		).toBe(true);
		expect(
			utils.canViewPrivateTicket(staff, {
				...base,
				private: true,
				visibility: TicketVisibility.Private
			})
		).toBe(false);
		expect(
			utils.canViewPrivateTicket(staff, {
				...base,
				private: true,
				visibility: TicketVisibility.Private,
				assignees: [{ id: 'u1' }]
			})
		).toBe(true);
	});
});

describe('editTicketMessage edited_by attribution', () => {
	it('stamps a different staff editor and clears it when the author edits their own', async () => {
		const rt = getRuntime();
		const utils = await import('#server-utils');
		const userA = await seedUser(rt, {
			username: 'author_a',
			email: 'a@example.com',
			role: Role.Agent
		});
		const userB = await seedUser(rt, {
			username: 'editor_b',
			email: 'b@example.com',
			role: Role.Manager
		});

		const ticket = await utils.createTicket(
			{ title: 'Edited', description: 'x', customer_id: 0 },
			rt.env
		);
		const msg = await utils.addTicketMessage(
			ticket.id,
			{
				message: 'original',
				sender: { kind: 'user', id: userA.id, username: 'author_a', name: 'Author A' }
			},
			rt.env
		);

		// a DIFFERENT staff member edits -> edited_by carries the editor id (and round-trips)
		const byOther = await utils.editTicketMessage(
			ticket.id,
			msg.id,
			'edited by b',
			undefined,
			rt.env,
			userB.id
		);
		expect(byOther.edited_by).toBe(userB.id);
		const readOther = await utils.getTicketMessage(ticket.id, msg.id, rt.env);
		expect(readOther.edited_by).toBe(userB.id);

		// the original author edits their own -> edited_by clears
		const bySelf = await utils.editTicketMessage(
			ticket.id,
			msg.id,
			'edited by a',
			undefined,
			rt.env,
			userA.id
		);
		expect(bySelf.edited_by ?? null).toBeNull();
		const readSelf = await utils.getTicketMessage(ticket.id, msg.id, rt.env);
		expect(readSelf.edited_by ?? null).toBeNull();
	});
});

describe('ticket participants', () => {
	it('adds a participant (normalized), dedupes, and hydrates onto the ticket', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');

		const first = await utils.addTicketParticipant(ticket.id, 'CC@Example.com', rt.env);
		expect(first.added).toBe(true);
		expect(first.participants).toEqual(['cc@example.com']);

		// case-insensitive dedupe; no-op returns added:false
		const dupe = await utils.addTicketParticipant(ticket.id, 'cc@example.com', rt.env);
		expect(dupe.added).toBe(false);
		expect(dupe.participants).toEqual(['cc@example.com']);

		expect(await utils.getTicketParticipants(ticket.id)).toEqual(['cc@example.com']);
		const fetched = await utils.getTicketById(ticket.id, rt.env);
		expect(fetched?.participants).toEqual(['cc@example.com']);
	});

	it('maintains the inverted index and ensures the participant customer exists', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');

		await utils.addTicketParticipant(ticket.id, 'indexed@example.com', rt.env);
		const cust = await utils.getCustomerByEmail('indexed@example.com', rt.env);
		expect(cust).not.toBeNull();
		expect(await utils.listParticipantTicketIds(cust!.id)).toContain(ticket.id);
	});

	it('skips the ticket own customer email', async () => {
		const { rt, ticket } = await seedPublicTicket(); // customer ann@example.com
		const utils = await import('#server-utils');
		const res = await utils.addTicketParticipant(ticket.id, 'ANN@example.com', rt.env);
		expect(res.added).toBe(false);
		expect(res.participants).toEqual([]);
	});

	it('removes a participant and cleans its inverted index', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		await utils.addTicketParticipant(ticket.id, 'gone@example.com', rt.env);
		const cust = await utils.getCustomerByEmail('gone@example.com', rt.env);

		const res = await utils.removeTicketParticipant(ticket.id, 'GONE@example.com', rt.env);
		expect(res.participants).toEqual([]);
		expect(await utils.getTicketParticipants(ticket.id)).toEqual([]);
		expect(await utils.listParticipantTicketIds(cust!.id)).not.toContain(ticket.id);
	});
});

describe('ticket timeline events', () => {
	it('emits a created event attributed to the acting user', async () => {
		const rt = getRuntime();
		const utils = await import('#server-utils');
		const actor = await seedUser(rt, { username: 'opener', email: 'opener@example.com' });

		const t = await utils.createTicket(
			{ title: 'Opened', description: 'x', customer_id: 0 },
			rt.env,
			{ actorId: actor.id }
		);

		const events = await utils.getTicketEvents(t.id);
		const created = events.find((e) => e.kind === 'created');
		expect(created).toBeTruthy();
		expect(created?.actor?.kind).toBe('user');
		expect((created?.actor as any)?.username).toBe('opener');
	});

	it('emits a renamed event with from/to and the acting user', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		const actor = await seedUser(rt, { username: 'editor', email: 'editor@example.com' });

		await utils.patchTicket(ticket.id, { title: 'Renamed title' }, rt.env, { actorId: actor.id });

		const events = await utils.getTicketEvents(ticket.id);
		const renamed = events.find((e) => e.kind === 'renamed');
		expect(renamed?.from).toBe('Login broken');
		expect(renamed?.to).toBe('Renamed title');
		expect((renamed?.actor as any)?.username).toBe('editor');
	});

	it('distinguishes generic status changes from close/reopen', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');

		await utils.patchTicket(ticket.id, { status: TicketStatus.Pending }, rt.env);
		await utils.patchTicket(ticket.id, { status: TicketStatus.Closed }, rt.env);
		await utils.patchTicket(ticket.id, { status: TicketStatus.Open }, rt.env);

		const kinds = (await utils.getTicketEvents(ticket.id)).map((e) => e.kind);
		expect(kinds).toContain('status');
		expect(kinds).toContain('closed');
		expect(kinds).toContain('reopened');
	});

	it('emits priority, visibility, color, icon, deadline, lock and archive events', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');

		await utils.patchTicket(
			ticket.id,
			{
				priority: TicketPriority.High,
				visibility: TicketVisibility.Internal,
				color: '#123456',
				icon: 'mdi:bug',
				deadline: '2026-09-01T00:00:00.000Z',
				locked: true
			},
			rt.env
		);
		await utils.patchTicket(ticket.id, { archived: true }, rt.env);
		await utils.patchTicket(ticket.id, { locked: false }, rt.env);

		const kinds = (await utils.getTicketEvents(ticket.id)).map((e) => e.kind);
		expect(kinds).toEqual(
			expect.arrayContaining([
				'priority',
				'visibility',
				'color',
				'icon',
				'deadline',
				'locked',
				'archived',
				'unlocked'
			])
		);
	});

	it('emits label add/remove events with the resolved label name', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		const label = await utils.createLabel('Bug', '#ff0000');

		await utils.patchTicket(ticket.id, { labels: [label.id] }, rt.env);
		await utils.patchTicket(ticket.id, { labels: [] }, rt.env);

		const events = await utils.getTicketEvents(ticket.id);
		const added = events.find((e) => e.kind === 'label_added');
		const removed = events.find((e) => e.kind === 'label_removed');
		expect(added?.to).toBe(String(label.id));
		expect(added?.label).toBe('Bug');
		expect(removed?.label).toBe('Bug');
	});

	it('emits assignee and project add/remove events', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		const assignee = await seedUser(rt, { username: 'assignee_a', email: 'aa@example.com' });

		await utils.patchTicket(ticket.id, { assignee_ids: [assignee.id] }, rt.env);
		await utils.patchTicket(ticket.id, { assignee_ids: [] }, rt.env);
		await utils.patchTicket(ticket.id, { project_ids: [7] }, rt.env);
		await utils.patchTicket(ticket.id, { project_ids: [] }, rt.env);

		const events = await utils.getTicketEvents(ticket.id);
		const kinds = events.map((e) => e.kind);
		expect(kinds).toEqual(
			expect.arrayContaining([
				'assignee_added',
				'assignee_removed',
				'project_added',
				'project_removed'
			])
		);
		expect(events.find((e) => e.kind === 'assignee_added')?.to).toBe(assignee.id);
		expect(events.find((e) => e.kind === 'project_added')?.to).toBe('7');
	});

	it('emits a customer_changed event', async () => {
		const rt = getRuntime();
		const utils = await import('#server-utils');
		const t = await utils.createTicket(
			{ title: 'Attach', description: 'x', customer_id: 0 },
			rt.env
		);
		const customer = await seedCustomer(rt, { name: 'Bea', email: 'bea@example.com' });

		await utils.patchTicket(t.id, { customer_id: customer.id }, rt.env);

		const changed = (await utils.getTicketEvents(t.id)).find((e) => e.kind === 'customer_changed');
		expect(changed?.from).toBe('0');
		expect(changed?.to).toBe(String(customer.id));
		expect(changed?.label).toBe('Bea');
	});

	it('attributes flow-driven changes to the flow name', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		await utils.createFlow({
			name: 'Escalate',
			trigger: 'ticket.updated',
			actions: [{ type: 'set_priority', value: TicketPriority.High }]
		});

		// a non-flow patch fires ticket.updated -> the flow raises priority under its own attribution
		await utils.patchTicket(ticket.id, { title: 'Trigger the flow' }, rt.env);

		const priority = (await utils.getTicketEvents(ticket.id)).find((e) => e.kind === 'priority');
		expect(priority?.to).toBe(TicketPriority.High);
		expect(priority?.flow_name).toBe('Escalate');
	});

	it('sorts events ascending by created_at', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		await utils.patchTicket(ticket.id, { title: 'First' }, rt.env);
		await utils.patchTicket(ticket.id, { title: 'Second' }, rt.env);

		const events = await utils.getTicketEvents(ticket.id);
		for (let i = 1; i < events.length; i += 1) {
			expect(new Date(events[i]!.created_at).getTime()).toBeGreaterThanOrEqual(
				new Date(events[i - 1]!.created_at).getTime()
			);
		}
	});
});

describe('ticket message edit history', () => {
	async function seedAuthoredMessage() {
		const rt = getRuntime();
		const utils = await import('#server-utils');
		const author = await seedUser(rt, { username: 'author', email: 'author@example.com' });
		const t = await utils.createTicket(
			{ title: 'History', description: 'x', customer_id: 0 },
			rt.env
		);
		const msg = await utils.addTicketMessage(
			t.id,
			{ message: 'v1', sender: { kind: 'user', id: author.id, username: 'author', name: 'A' } },
			rt.env
		);
		return { rt, utils, author, ticketId: t.id, messageId: msg.id };
	}

	it('captures prior versions newest-last and surfaces them on read', async () => {
		const { rt, utils, author, ticketId, messageId } = await seedAuthoredMessage();

		await utils.editTicketMessage(ticketId, messageId, 'v2', undefined, rt.env, author.id);
		const edited = await utils.editTicketMessage(
			ticketId,
			messageId,
			'v3',
			undefined,
			rt.env,
			author.id
		);

		expect(edited.message).toBe('v3');
		expect(edited.edit_history?.map((v: any) => v.message)).toEqual(['v1', 'v2']);

		const read = await utils.getTicketMessage(ticketId, messageId, getRuntime().env);
		expect(read.message).toBe('v3');
		expect(read.edit_history?.map((v: any) => v.message)).toEqual(['v1', 'v2']);
	});

	it('has no edit_history on a never-edited message', async () => {
		const { utils, ticketId, messageId } = await seedAuthoredMessage();
		const read = await utils.getTicketMessage(ticketId, messageId, getRuntime().env);
		expect(read.edit_history).toBeUndefined();
	});

	it('nulls the history slot when a message is deleted', async () => {
		const rt = getRuntime();
		const utils = await import('#server-utils');
		const author = await seedUser(rt, { username: 'auth2', email: 'auth2@example.com' });
		const t = await utils.createTicket(
			{ title: 'DelHist', description: 'x', customer_id: 0 },
			rt.env
		);
		const first = await utils.addTicketMessage(
			t.id,
			{ message: 'first', sender: { kind: 'user', id: author.id, username: 'auth2', name: 'B' } },
			rt.env
		);
		await utils.editTicketMessage(t.id, first.id, 'first-edited', undefined, rt.env, author.id);
		await utils.addTicketMessage(
			t.id,
			{ message: 'second', sender: { kind: 'user', id: author.id, username: 'auth2', name: 'B' } },
			rt.env
		);

		await utils.deleteTicketMessage(t.id, first.id, rt.env, { actorId: author.id });

		const thread = await utils.getTicketThread(t.id, rt.env);
		const surviving = thread.messages.map((m: any) => m.message);
		expect(surviving).toEqual(['second']);
		expect(thread.messages.every((m: any) => m.edit_history === undefined)).toBe(true);
	});
});

describe('ticket audit hooks', () => {
	async function actionsFor(env: any, action: string) {
		const utils = await import('#server-utils');
		const { results } = await utils.listAudit(env, { action });
		return results;
	}

	it('records create/update/delete audit rows', async () => {
		const rt = getRuntime();
		const utils = await import('#server-utils');
		const actor = await seedUser(rt, { username: 'auditor', email: 'auditor@example.com' });

		const t = await utils.createTicket(
			{ title: 'Audited', description: 'x', customer_id: 0 },
			rt.env,
			{ actorId: actor.id }
		);
		const created = await actionsFor(rt.env, 'ticket.created');
		expect(created.some((r: any) => r.ticket_id === t.id && r.actor_id === actor.id)).toBe(true);

		await utils.patchTicket(t.id, { title: 'Audited 2' }, rt.env, { actorId: actor.id });
		const updated = await actionsFor(rt.env, 'ticket.updated');
		expect(updated.some((r: any) => r.ticket_id === t.id)).toBe(true);

		await utils.deleteTicket(t.id, rt.env, { actorId: actor.id });
		const deleted = await actionsFor(rt.env, 'ticket.deleted');
		expect(deleted.some((r: any) => r.ticket_id === t.id)).toBe(true);
	});

	it('records message add/edit/delete audit rows', async () => {
		const rt = getRuntime();
		const utils = await import('#server-utils');
		const author = await seedUser(rt, { username: 'msgauthor', email: 'ma@example.com' });
		const t = await utils.createTicket(
			{ title: 'MsgAudit', description: 'x', customer_id: 0 },
			rt.env
		);
		const msg = await utils.addTicketMessage(
			t.id,
			{ message: 'hi', sender: { kind: 'user', id: author.id, username: 'msgauthor', name: 'M' } },
			rt.env
		);
		expect(
			(await actionsFor(rt.env, 'ticket.message_added')).some((r: any) => r.ticket_id === t.id)
		).toBe(true);

		await utils.editTicketMessage(t.id, msg.id, 'hi edited', undefined, rt.env, author.id);
		expect(
			(await actionsFor(rt.env, 'ticket.message_edited')).some((r: any) => r.ticket_id === t.id)
		).toBe(true);

		await utils.deleteTicketMessage(t.id, msg.id, rt.env, { actorId: author.id });
		expect(
			(await actionsFor(rt.env, 'ticket.message_deleted')).some((r: any) => r.ticket_id === t.id)
		).toBe(true);
	});

	it('records participant add/remove audit rows', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		const actor = await seedUser(rt, { username: 'partadmin', email: 'pa@example.com' });

		await utils.addTicketParticipant(ticket.id, 'cc@example.com', rt.env, { actorId: actor.id });
		expect(
			(await actionsFor(rt.env, 'ticket.participant_added')).some(
				(r: any) => r.ticket_id === ticket.id
			)
		).toBe(true);

		await utils.removeTicketParticipant(ticket.id, 'cc@example.com', rt.env, { actorId: actor.id });
		expect(
			(await actionsFor(rt.env, 'ticket.participant_removed')).some(
				(r: any) => r.ticket_id === ticket.id
			)
		).toBe(true);
	});
});

describe('GET /api/tickets/[id]/events', () => {
	it('returns the timeline for a viewable ticket', async () => {
		const rt = getRuntime();
		const utils = await import('#server-utils');
		const manager = await seedManager(rt);
		const t = await utils.createTicket(
			{ title: 'RouteEvents', description: 'x', customer_id: 0 },
			rt.env,
			{ actorId: manager.id }
		);
		await utils.patchTicket(t.id, { title: 'RouteEvents 2' }, rt.env, { actorId: manager.id });

		const handler = await importRoute('~/server/api/tickets/[id]/events.get');
		mockParams({ id: t.id });
		const result = (await handler(eventFor(rt.env, manager.sessionToken))) as { events: any[] };
		const kinds = result.events.map((e) => e.kind);
		expect(kinds).toContain('created');
		expect(kinds).toContain('renamed');
	});

	it('rejects an anonymous request', async () => {
		const rt = getRuntime();
		const utils = await import('#server-utils');
		const t = await utils.createTicket(
			{ title: 'NoAuth', description: 'x', customer_id: 0 },
			rt.env
		);
		const handler = await importRoute('~/server/api/tickets/[id]/events.get');
		mockParams({ id: t.id });
		await expect(handler(eventFor(rt.env))).rejects.toMatchObject({ statusCode: 401 });
	});
});

describe('public status timeline', () => {
	it('returns sanitized events without actor email', async () => {
		const { rt, ticket } = await seedPublicTicket();
		const utils = await import('#server-utils');
		const actor = await seedUser(rt, { username: 'agent_x', email: 'agentx@example.com' });
		await utils.patchTicket(ticket.id, { title: 'Public rename' }, rt.env, { actorId: actor.id });

		const token = await utils.hmacSha256(rt.env.HMAC_SECRET, `status:${ticket.id}`);
		const handler = await importRoute('~/server/api/public/status.get');
		mockCookie(null);
		mockQuery({ id: ticket.id, token });
		const result = (await handler(eventFor(rt.env))) as { events: any[] };

		const renamed = result.events.find((e) => e.kind === 'renamed');
		expect(renamed?.to).toBe('Public rename');
		expect(renamed?.actor?.username).toBe('agent_x');
		expect(renamed?.actor?.email).toBeUndefined();
	});
});
