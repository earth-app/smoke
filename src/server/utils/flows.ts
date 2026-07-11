import type {
	FlowAction,
	FlowCondition,
	FlowConditionField,
	FlowConditionGroup,
	FlowConditionNode,
	FlowEvent,
	FlowOperator,
	FlowTrigger,
	Ticket,
	TicketActor,
	TicketFlow,
	TicketPatchInput
} from '~/shared/types/ticket';

// all flow rules live in a single kv array; email/settings state is kv-only, no db schema
const FLOWS_KEY = 'smoke:setting:flows';

// cap recursion so a hand-edited kv blob (or a cyclic ref) can't hang the evaluator
const MAX_TREE_DEPTH = 10;

// #region types

export type FlowInput = {
	name: string;
	enabled?: boolean;
	trigger: FlowTrigger;
	match?: 'all' | 'any';
	conditions?: FlowCondition[];
	// nested boolean tree; null clears a stored tree on patch, undefined leaves it as-is
	condition_tree?: FlowConditionGroup | null;
	actions: FlowAction[];
};

export type FlowPatch = Partial<FlowInput>;

// #endregion

// #region normalizers

const FLOW_TRIGGERS: FlowTrigger[] = [
	'ticket.created',
	'ticket.updated',
	'ticket.message',
	'ticket.deleted',
	'customer.created',
	'customer.added',
	'label.added',
	'label.removed',
	'assignee.added',
	'assignee.removed',
	'label.created',
	'label.updated',
	'label.deleted',
	'agent.created',
	'agent.updated',
	'agent.deleted'
];
const CONDITION_FIELDS: FlowConditionField[] = [
	'title',
	'description',
	'status',
	'priority',
	'customer_email'
];
const CONDITION_OPERATORS: FlowOperator[] = [
	'contains',
	'equals',
	'matches',
	'not_contains',
	'starts_with',
	'ends_with',
	'gt',
	'lt',
	'in_list'
];
const ACTION_TYPES: FlowAction['type'][] = [
	'set_color',
	'set_priority',
	'set_status',
	'set_visibility',
	'assign',
	'set_project',
	'archive',
	'add_label',
	'set_icon',
	'lock_thread',
	'email_customer',
	'reply_in_thread'
];
// message actions carry a body + ai/auto-send/identity options; others are single-value
const MESSAGE_ACTION_TYPES: FlowAction['type'][] = ['reply_in_thread', 'email_customer'];

function isMessageAction(type: FlowAction['type']): boolean {
	return MESSAGE_ACTION_TYPES.includes(type);
}

// split a comma list into trimmed non-empty items
function parseList(value: string): string[] {
	return String(value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

// in_list is only valid with 2-20 non-empty items; anything else is dropped
function isValidList(value: string): boolean {
	const items = parseList(value);
	return items.length >= 2 && items.length <= 20;
}

// a well-formed leaf: known field/operator, string value, and a valid list when in_list
function isValidLeaf(c: any): c is FlowCondition {
	return (
		!!c &&
		CONDITION_FIELDS.includes(c.field) &&
		CONDITION_OPERATORS.includes(c.operator) &&
		typeof c.value === 'string' &&
		(c.operator !== 'in_list' || isValidList(c.value))
	);
}

// drop malformed rows so a hand-edited kv blob can't crash the engine
function normalizeConditions(conditions?: FlowCondition[]): FlowCondition[] {
	if (!Array.isArray(conditions)) return [];
	return conditions
		.filter(isValidLeaf)
		.map((c) => ({ field: c.field, operator: c.operator, value: c.value }));
}

function isGroupNode(node: any): node is FlowConditionGroup {
	return !!node && typeof node === 'object' && node.kind === 'group';
}

// recursively validate/prune a condition tree: drop malformed leaves (same rules as the flat
// normalizer), drop empty nested groups (noise), and cap depth so pathological input can't recurse
// forever. the root group may be empty (matches true, i.e. always run)
function normalizeConditionTree(group: any, depth = 0): FlowConditionGroup {
	const match = group?.match === 'any' ? 'any' : 'all';
	if (!group || !Array.isArray(group.conditions) || depth >= MAX_TREE_DEPTH) {
		return { kind: 'group', match, conditions: [] };
	}
	const conditions: FlowConditionNode[] = [];
	for (const node of group.conditions) {
		if (isGroupNode(node)) {
			const child = normalizeConditionTree(node, depth + 1);
			if (child.conditions.length > 0) conditions.push(child);
		} else if (isValidLeaf(node)) {
			conditions.push({
				kind: 'condition',
				field: node.field,
				operator: node.operator,
				value: node.value
			});
		}
	}
	return { kind: 'group', match, conditions };
}

function normalizeActions(actions?: FlowAction[]): FlowAction[] {
	if (!Array.isArray(actions)) return [];
	return actions
		.filter((a) => a && ACTION_TYPES.includes(a.type) && typeof a.value === 'string')
		.map((a) => {
			if (!isMessageAction(a.type)) return { type: a.type, value: a.value };
			// preserve the message-action extras; coerce to safe defaults
			return {
				type: a.type,
				value: a.value,
				ai: a.ai === true,
				auto_send: a.auto_send === true,
				identity: a.identity === 'automation' ? 'automation' : 'team'
			};
		});
}

// #endregion

// #region kv crud

export async function listFlows(): Promise<TicketFlow[]> {
	try {
		const raw = await kv.get<TicketFlow[]>(FLOWS_KEY, 'json');
		return Array.isArray(raw) ? raw : [];
	} catch {
		return [];
	}
}

async function saveFlows(flows: TicketFlow[]): Promise<void> {
	await kv.set(FLOWS_KEY, JSON.stringify(flows));
}

export async function getFlow(id: number): Promise<TicketFlow | null> {
	const flows = await listFlows();
	return flows.find((f) => f.id === id) ?? null;
}

export async function createFlow(input: FlowInput): Promise<TicketFlow> {
	const flows = await listFlows();
	const nextId = flows.reduce((max, f) => Math.max(max, f.id), 0) + 1;

	const flow: TicketFlow = {
		id: nextId,
		name: input.name,
		enabled: input.enabled ?? true,
		trigger: input.trigger,
		match: input.match ?? 'all',
		conditions: normalizeConditions(input.conditions),
		...(input.condition_tree
			? { condition_tree: normalizeConditionTree(input.condition_tree) }
			: {}),
		actions: normalizeActions(input.actions)
	};

	flows.push(flow);
	await saveFlows(flows);
	return flow;
}

export async function updateFlow(id: number, patch: FlowPatch): Promise<TicketFlow> {
	const flows = await listFlows();
	const index = flows.findIndex((f) => f.id === id);
	if (index === -1) {
		throw createError({ statusCode: 404, message: 'Flow not found' });
	}

	const current = flows[index]!;
	const updated: TicketFlow = {
		...current,
		...(patch.name !== undefined ? { name: patch.name } : {}),
		...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
		...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
		...(patch.match !== undefined ? { match: patch.match } : {}),
		...(patch.conditions !== undefined
			? { conditions: normalizeConditions(patch.conditions) }
			: {}),
		...(patch.condition_tree !== undefined
			? {
					// null clears the tree (falls back to flat conditions); a group is normalized
					condition_tree: patch.condition_tree
						? normalizeConditionTree(patch.condition_tree)
						: undefined
				}
			: {}),
		...(patch.actions !== undefined ? { actions: normalizeActions(patch.actions) } : {})
	};

	flows[index] = updated;
	await saveFlows(flows);
	return updated;
}

export async function deleteFlow(id: number): Promise<void> {
	const flows = await listFlows();
	const next = flows.filter((f) => f.id !== id);
	if (next.length === flows.length) {
		throw createError({ statusCode: 404, message: 'Flow not found' });
	}
	await saveFlows(next);
}

// #endregion

// #region condition evaluation

function fieldValue(field: FlowConditionField, ticket?: Ticket, email?: string): string {
	switch (field) {
		case 'title':
			return ticket?.title ?? '';
		case 'description':
			return ticket?.description ?? '';
		case 'status':
			return ticket?.status ?? '';
		case 'priority':
			return ticket?.priority ?? '';
		case 'customer_email':
			return email ?? '';
		default:
			return '';
	}
}

// enum-backed fields compare by their position in the enum order; others parse as numbers
function enumOrder(field: FlowConditionField): string[] | null {
	if (field === 'priority')
		return (Object.values(TicketPriority) as string[]).map((v) => v.toLowerCase());
	if (field === 'status')
		return (Object.values(TicketStatus) as string[]).map((v) => v.toLowerCase());
	return null;
}

// resolve a comparable numeric pair for gt/lt; null when either side isn't comparable
function orderedPair(
	field: FlowConditionField,
	actual: string,
	expected: string
): [number, number] | null {
	const order = enumOrder(field);
	if (order) {
		const a = order.indexOf(actual);
		const b = order.indexOf(expected);
		if (a < 0 || b < 0) return null;
		return [a, b];
	}
	const a = Number(actual);
	const b = Number(expected);
	if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
	return [a, b];
}

function evalCondition(cond: FlowCondition, ticket?: Ticket, email?: string): boolean {
	const raw = fieldValue(cond.field, ticket, email);
	const actual = String(raw).toLowerCase();
	const expected = String(cond.value ?? '').toLowerCase();

	switch (cond.operator) {
		case 'contains':
			return actual.includes(expected);
		case 'not_contains':
			return !actual.includes(expected);
		case 'equals':
			return actual === expected;
		case 'starts_with':
			return actual.startsWith(expected);
		case 'ends_with':
			return actual.endsWith(expected);
		case 'gt': {
			const pair = orderedPair(cond.field, actual, expected);
			return pair ? pair[0] > pair[1] : false;
		}
		case 'lt': {
			const pair = orderedPair(cond.field, actual, expected);
			return pair ? pair[0] < pair[1] : false;
		}
		case 'in_list':
			return parseList(cond.value).some((item) => item.toLowerCase() === actual);
		case 'matches':
			try {
				// case-insensitive test; an invalid pattern is treated as no match
				return new RegExp(cond.value ?? '', 'i').test(String(raw));
			} catch {
				return false;
			}
		default:
			return false;
	}
}

// recursively evaluate a condition node: a leaf uses evalCondition; a group folds its children
// with all (every) / any (some). an empty group matches true (mirrors the empty-conditions rule);
// over-deep nodes are treated as a pass so the tree can never hang or throw
function evalConditionNode(
	node: FlowConditionNode,
	ticket?: Ticket,
	email?: string,
	depth = 0
): boolean {
	if (depth >= MAX_TREE_DEPTH) return true;
	if (isGroupNode(node)) {
		const conditions = Array.isArray(node.conditions) ? node.conditions : [];
		if (conditions.length === 0) return true;
		const results = conditions.map((c) => evalConditionNode(c, ticket, email, depth + 1));
		return node.match === 'any' ? results.some(Boolean) : results.every(Boolean);
	}
	return evalCondition(node as FlowCondition, ticket, email);
}

function flowMatches(flow: TicketFlow, ticket?: Ticket, email?: string): boolean {
	// a nested tree, when present, supersedes the flat conditions/match
	if (flow.condition_tree) return evalConditionNode(flow.condition_tree, ticket, email);
	// legacy flat path: no conditions means the rule always fires (trello "when created" style)
	if (!flow.conditions || flow.conditions.length === 0) return true;
	const results = flow.conditions.map((c) => evalCondition(c, ticket, email));
	return flow.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

// #endregion

// #region action application

// translate a flow's non-message actions into a single ticket patch; assignees/labels accumulate
// onto the ticket's current lists so multiple add-actions compose instead of overwriting.
// message actions (reply_in_thread/email_customer) are handled separately (they post/send)
function buildUpdates(actions: FlowAction[], ticket: Ticket): TicketPatchInput {
	const updates: TicketPatchInput = {};
	let assignees = ticket.assignees.map((a) => a.id);
	let labels = [...ticket.labels];

	for (const action of actions) {
		switch (action.type) {
			case 'set_color':
				updates.color = action.value;
				break;
			case 'set_icon':
				// empty string clears the icon
				updates.icon = action.value === '' ? null : action.value;
				break;
			case 'set_priority':
				if ((Object.values(TicketPriority) as string[]).includes(action.value)) {
					updates.priority = action.value as TicketPriority;
				}
				break;
			case 'set_status':
				if ((Object.values(TicketStatus) as string[]).includes(action.value)) {
					updates.status = action.value as TicketStatus;
				}
				break;
			case 'set_visibility':
				if ((Object.values(TicketVisibility) as string[]).includes(action.value)) {
					updates.visibility = action.value as TicketVisibility;
				}
				break;
			case 'assign': {
				const id = action.value?.trim();
				if (id && !assignees.includes(id)) {
					assignees = [...assignees, id];
					updates.assignee_ids = assignees;
				}
				break;
			}
			case 'add_label': {
				const id = Number(action.value);
				if (Number.isFinite(id) && !labels.includes(id)) {
					labels = [...labels, id];
					updates.labels = labels;
				}
				break;
			}
			case 'set_project': {
				const pid = action.value === '' ? null : Number(action.value);
				updates.project_id = pid != null && Number.isFinite(pid) ? pid : null;
				break;
			}
			case 'lock_thread':
				// honor an explicit 'false'; anything else locks the thread
				updates.locked = action.value?.trim().toLowerCase() !== 'false';
				break;
			case 'archive':
				// archive maps to closing the ticket (no separate archived status exists)
				updates.status = TicketStatus.Closed;
				break;
		}
	}

	return updates;
}

// substitute {{ticket.*}}/{{customer.*}}/{{label.*}}/{{assignee.*}}/{{agent.*}} tokens for the
// current event; unknown tokens go blank. context maps mirror the flow ui placeholder sets
function substitutePlaceholders(template: string, event: FlowEvent): string {
	const ticket = event.ticket;
	const email = event.customer_email ?? event.customer?.email ?? '';
	const map: Record<string, string> = {
		'ticket.title': ticket?.title ?? '',
		'ticket.id': ticket ? String(ticket.id) : '',
		'ticket.status': ticket?.status ?? '',
		'ticket.priority': ticket?.priority ?? '',
		'ticket.description': ticket?.description ?? '',
		'customer.email': email,
		'customer.name': event.customer?.name ?? '',
		'label.name': event.label?.name ?? '',
		'label.color': event.label?.color ?? '',
		'assignee.name': event.assignee?.name ?? '',
		'assignee.username': event.assignee?.username ?? '',
		'agent.username': event.agent?.username ?? '',
		'agent.name': event.agent?.name ?? '',
		'agent.role': event.agent?.role ?? ''
	};
	return String(template ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) =>
		key in map ? map[key]! : ''
	);
}

// re-entrancy guard: a message posted by a flow fires ticket.message; suppress that nested run
// so a reply/email action can never loop (mirrors the patch path's skipFlows)
let suppressMessageTrigger = false;

// apply one reply_in_thread/email_customer action; never throws out of the engine
async function applyMessageAction(action: FlowAction, event: FlowEvent, env: any): Promise<void> {
	const ticket = event.ticket;
	// without a ticket (customer.created) there's no thread to post into; only email_customer can
	// deliver, as a standalone email to the customer address (ai drafting needs a ticket, so skip it)
	if (!ticket) {
		if (action.type !== 'email_customer') return;
		const to = event.customer_email ?? event.customer?.email ?? '';
		const text = substitutePlaceholders(action.value ?? '', event);
		if (!to || !text.trim()) return;
		await sendCustomerEmail(to, 'A Message from Support', text, env).catch(() => {});
		return;
	}

	const settings = await getAutomationSettings();
	const identity = action.identity ?? settings.identity;
	const displayName = identity === 'automation' ? settings.name : 'Team';

	const template = substitutePlaceholders(action.value ?? '', event);
	let text = template;
	let isAi = false;
	if (action.ai) {
		const result = await generateAiReply(
			{ ticket, extraContext: template || undefined },
			env
		).catch(() => null);
		if (result?.text) {
			text = result.text;
			isAi = true;
		}
	}
	if (!text || !text.trim()) return;

	const sender: TicketActor =
		identity === 'automation'
			? {
					kind: 'user',
					id: 'automation',
					username: 'automation',
					name: settings.name,
					avatar_url: 'icon:mdi:robot'
				}
			: { kind: 'user', id: '0', username: 'team', name: 'Team' };
	if (isAi) sender.ai = true;

	const autoSend = action.auto_send === true;
	if (!autoSend) {
		// draft: an internal note for an agent to review; no ai trailer since it isn't sent
		suppressMessageTrigger = true;
		try {
			await addTicketMessage(ticket.id, { message: text, sender, private: true }, env);
		} finally {
			suppressMessageTrigger = false;
		}
		return;
	}

	// auto-send: post the customer-visible reply, then mirror it over email
	const body = isAi ? `${text}${AI_TRAILER}` : text;
	suppressMessageTrigger = true;
	try {
		await addTicketMessage(ticket.id, { message: body, sender, private: false }, env);
	} finally {
		suppressMessageTrigger = false;
	}
	try {
		await sendTicketEmailReply(ticket.id, body, env, undefined, {
			identity: 'team',
			agentName: displayName
		});
	} catch {
		// email is best-effort; a transport failure must never break the engine
	}
}

async function applyMessageActions(
	actions: FlowAction[],
	event: FlowEvent,
	env: any
): Promise<void> {
	for (const action of actions) {
		if (!isMessageAction(action.type)) continue;
		try {
			await applyMessageAction(action, event, env);
		} catch {
			// one bad message action can't block the rest
		}
	}
}

// #endregion

// #region engine

// runs enabled automation flows for an event: load rules for this trigger, evaluate their
// conditions against the ticket (+ customer email), apply matched patch actions, then dispatch
// message actions. patchTicket is always called with skipFlows so an action can't re-trigger the
// engine. defensive throughout; one bad rule never stops the rest and the engine never throws
export async function runTicketFlows(event: FlowEvent, env: any): Promise<void> {
	// a message posted by a flow re-fires ticket.message; ignore that nested run to avoid loops
	if (suppressMessageTrigger && event.trigger === 'ticket.message') return;
	try {
		if (!FLOW_TRIGGERS.includes(event.trigger)) return;
		const flows = await listFlows();
		const applicable = flows.filter((f) => f.enabled && f.trigger === event.trigger);
		if (applicable.length === 0) return;

		// track the latest ticket state so later rules see earlier rules' mutations
		let ticket = event.ticket;
		const email = event.customer_email ?? event.customer?.email;

		for (const flow of applicable) {
			try {
				if (!flowMatches(flow, ticket, email)) continue;

				// patch actions only apply when there's a ticket to mutate
				if (ticket) {
					const updates = buildUpdates(flow.actions, ticket);
					if (Object.keys(updates).length > 0) {
						ticket = await patchTicket(ticket.id, updates, env, { skipFlows: true });
					}
				}

				// message/email actions run against the freshest ticket snapshot
				await applyMessageActions(flow.actions, { ...event, ticket, customer_email: email }, env);
			} catch {
				// swallow so one misconfigured rule can't block the others
			}
		}
	} catch {
		// never let the engine break the create/patch/message paths that call it
	}
}

// #endregion
