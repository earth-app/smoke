import { allAllShardsGlobal, first, run } from '@earth-app/collegedb';
import type { DBTicket } from 'hub:db:schema';
import { ensureCollegeDB } from 'hub:db:schema';

// #region types

type TicketEncryptedSection = {
	data: unknown;
	wrapped_dek: unknown;
	nonce: unknown;
	tag: unknown;
	algorithm: unknown;
	version: unknown;
};

type StoredTicketMessage = Omit<
	TicketMessage,
	'sender_id' | 'attachments' | 'created_at' | 'private' | 'edited_at'
> & {
	created_at: string;
	edited_at?: string | null;
	edited_by?: string | null;
	// per-message internal-note flag; optional so legacy rows (written before it was persisted) read back
	// via the sender-aware fallback in fromStoredTicketMessage
	private?: boolean;
};

type StoredTicketAttachment = {
	id: number;
	ticket_id: number;
	data: string;
	file_name: string;
	mimetype: string;
	created_at: string;
};

// a prior message body kept in the encrypted history section (index-aligned with messages)
type StoredTicketMessageVersion = {
	message: string;
	edited_at: string;
	edited_by?: string | null;
};

// #endregion

// #region csv utils

function parseCsvStringList(value: unknown): string[] {
	if (value == null || value === '') return [];
	return String(value)
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function parseCsvNumberList(value: unknown): number[] {
	return parseCsvStringList(value)
		.map((entry) => Number(entry))
		.filter((entry) => Number.isFinite(entry));
}

function joinCsvStringList(values?: string[] | null): string | null {
	if (!values || values.length === 0) return null;
	return Array.from(
		new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
	).join(',');
}

function joinCsvNumberList(values?: number[] | null): string | null {
	if (!values || values.length === 0) return null;
	return Array.from(new Set(values.filter((value) => Number.isFinite(value)))).join(',');
}

// #endregion

// #region normalizers

function normalizeTicketStatus(value: unknown): TicketStatus {
	if (Object.values(TicketStatus).includes(value as TicketStatus)) {
		return value as TicketStatus;
	}

	throw createError({
		statusCode: 500,
		message: 'Invalid ticket status on ticket record'
	});
}

function normalizeTicketPriority(value: unknown): TicketPriority {
	if (Object.values(TicketPriority).includes(value as TicketPriority)) {
		return value as TicketPriority;
	}

	throw createError({
		statusCode: 500,
		message: 'Invalid ticket priority on ticket record'
	});
}

// #endregion

// #region dbticket <-> ticket

function toStoredTicketMessage(message: TicketMessage): StoredTicketMessage {
	return {
		id: message.id,
		ticket_id: message.ticket_id,
		reply_to: message.reply_to,
		sender: message.sender,
		message: message.message,
		private: message.private,
		created_at: message.created_at.toISOString(),
		edited_at: message.edited_at ? message.edited_at.toISOString() : undefined,
		edited_by: message.edited_by ?? null
	};
}

function fromStoredTicketMessage(
	message: StoredTicketMessage,
	ticket: DBTicket,
	attachments?: TicketAttachment[],
	editHistory?: TicketMessageVersion[]
): TicketMessage {
	return {
		id: message.id,
		ticket_id: message.ticket_id,
		reply_to: message.reply_to,
		sender: message.sender,
		sender_id: message.sender.id.toString(),
		private: message.private ?? (message.sender.kind === 'customer' ? false : ticket.private === 1),
		message: message.message,
		created_at: new Date(message.created_at),
		edited_at: message.edited_at ? new Date(message.edited_at) : null,
		edited_by: message.edited_by ?? undefined,
		attachments: attachments && attachments.length > 0 ? attachments : undefined,
		edit_history: editHistory && editHistory.length > 0 ? editHistory : undefined
	};
}

function fromStoredMessageVersion(version: StoredTicketMessageVersion): TicketMessageVersion {
	return {
		message: version.message,
		edited_at: new Date(version.edited_at),
		edited_by: version.edited_by ?? null
	};
}

function toStoredTicketAttachment(attachment: TicketAttachment): StoredTicketAttachment {
	return {
		id: attachment.id,
		ticket_id: attachment.ticket_id,
		data: attachment.data,
		file_name: attachment.file_name,
		mimetype: attachment.mimetype,
		created_at: attachment.created_at.toISOString()
	};
}

function fromStoredTicketAttachment(attachment: StoredTicketAttachment): TicketAttachment {
	return {
		id: attachment.id,
		ticket_id: attachment.ticket_id,
		data: attachment.data,
		file_name: attachment.file_name,
		mimetype: attachment.mimetype,
		created_at: new Date(attachment.created_at)
	};
}

// #endregion

// #region encryption

function ticketSectionBindings(
	encrypted: Awaited<ReturnType<typeof encrypt>> | null
): Array<Uint8Array | string | number | null> {
	if (!encrypted) {
		return [null, null, null, null, null, null];
	}

	return [
		encrypted.ciphertext,
		encrypted.wrapped_dek,
		encrypted.nonce,
		encrypted.tag,
		encrypted.algorithm,
		encrypted.version
	];
}

function hasCompleteEncryptedSection(section: TicketEncryptedSection): boolean {
	const values = [
		section.data,
		section.wrapped_dek,
		section.nonce,
		section.tag,
		section.algorithm,
		section.version
	];

	return values.every((value) => value != null);
}

async function decryptTicketSection<T>(
	section: TicketEncryptedSection,
	masterKey: string
): Promise<T | null> {
	if (!hasCompleteEncryptedSection(section)) {
		const hasAny = Object.values(section).some((value) => value != null);
		if (hasAny) {
			throw createError({
				statusCode: 500,
				message: 'Invalid ticket encryption metadata'
			});
		}

		return null;
	}

	const decrypted = await decrypt(
		{
			data: toUint8Array(section.data, 'ticket_section_data'),
			wrapped_dek: toUint8Array(section.wrapped_dek, 'ticket_section_wrapped_dek'),
			nonce: toUint8Array(section.nonce, 'ticket_section_nonce'),
			tag: toUint8Array(section.tag, 'ticket_section_tag'),
			algorithm: toEncryptionAlgorithm(section.algorithm),
			version: Number(section.version)
		},
		masterKey
	);

	return decrypted as T;
}

async function readTicketSections(
	row: DBTicket,
	masterKey: string
): Promise<{
	messages: (StoredTicketMessage | null)[] | null;
	attachments: (StoredTicketAttachment[] | null)[] | null;
	history: (StoredTicketMessageVersion[] | null)[] | null;
}> {
	const messages = await decryptTicketSection<(StoredTicketMessage | null)[]>(
		{
			data: row.messages_data,
			wrapped_dek: row.messages_wrapped_dek,
			nonce: row.messages_nonce,
			tag: row.messages_tag,
			algorithm: row.messages_algorithm,
			version: row.messages_version
		},
		masterKey
	);

	const attachments = await decryptTicketSection<(StoredTicketAttachment[] | null)[] | null>(
		{
			data: row.attachments_data,
			wrapped_dek: row.attachments_wrapped_dek,
			nonce: row.attachments_nonce,
			tag: row.attachments_tag,
			algorithm: row.attachments_algorithm,
			version: row.attachments_version
		},
		masterKey
	);

	// third parallel section: prior versions per message (index-aligned with messages)
	const history = await decryptTicketSection<(StoredTicketMessageVersion[] | null)[] | null>(
		{
			data: row.history_data,
			wrapped_dek: row.history_wrapped_dek,
			nonce: row.history_nonce,
			tag: row.history_tag,
			algorithm: row.history_algorithm,
			version: row.history_version
		},
		masterKey
	);

	return { messages, attachments, history };
}

async function writeTicketSections(
	id: number,
	messages: (StoredTicketMessage | null)[] | null,
	attachments: (StoredTicketAttachment[] | null)[] | null,
	history: (StoredTicketMessageVersion[] | null)[] | null,
	env: any
): Promise<void> {
	const messagesEncrypted = messages ? await encrypt(messages, env.MASTER_KEY) : null;
	const attachmentsEncrypted = attachments ? await encrypt(attachments, env.MASTER_KEY) : null;
	const historyEncrypted = history ? await encrypt(history, env.MASTER_KEY) : null;
	const updatedAt = Math.floor(Date.now() / 1000);

	await run(
		id.toString(),
		`UPDATE tickets
		 SET messages_data = ?, messages_wrapped_dek = ?, messages_nonce = ?, messages_tag = ?, messages_algorithm = ?, messages_version = ?,
		     attachments_data = ?, attachments_wrapped_dek = ?, attachments_nonce = ?, attachments_tag = ?, attachments_algorithm = ?, attachments_version = ?,
		     history_data = ?, history_wrapped_dek = ?, history_nonce = ?, history_tag = ?, history_algorithm = ?, history_version = ?,
		     updated_at = ?
		 WHERE id = ?`,
		[
			...ticketSectionBindings(messagesEncrypted),
			...ticketSectionBindings(attachmentsEncrypted),
			...ticketSectionBindings(historyEncrypted),
			updatedAt,
			id
		]
	);

	await invalidateTicketCache(id);
}

// #endregion

// #region hydration

async function hydrateTicket(row: DBTicket, env: any): Promise<Ticket> {
	const assigneeIds = parseCsvStringList(row.assignees);
	const assignees = (
		await Promise.all(assigneeIds.map(async (assigneeId) => await getUserById(assigneeId, env)))
	).filter((assignee): assignee is User => assignee !== null);

	const meta = await getTicketMeta(row.id);
	const visibility =
		(meta.visibility as TicketVisibility) ??
		(row.private === 1 ? TicketVisibility.Private : TicketVisibility.Public);

	// project_ids is the source of truth; fall back to the legacy single project_id
	const projectIds =
		Array.isArray(meta.project_ids) && meta.project_ids.length > 0
			? meta.project_ids
			: meta.project_id != null
				? [meta.project_id]
				: [];

	return {
		id: row.id,
		title: row.title,
		description: row.description,
		status: normalizeTicketStatus(row.status),
		priority: normalizeTicketPriority(row.priority),
		labels: parseCsvNumberList(row.labels),
		private: row.private === 1,
		visibility,
		color: meta.color ?? null,
		icon: meta.icon ?? null,
		deadline: meta.deadline ? new Date(meta.deadline) : null,
		project_id: projectIds[0] ?? null,
		project_ids: projectIds,
		custom_fields: meta.custom_fields ?? {},
		locked: meta.locked === true,
		archived: meta.archived === true,
		archived_at: meta.archived_at ? new Date(meta.archived_at) : null,
		created_by: meta.created_by ?? null,
		participants: Array.isArray(meta.participants) ? meta.participants : [],
		customer_id: Number(row.customer_id),
		assignees,
		created_at: new Date(Number(row.created_at) * 1000),
		updated_at: new Date(Number(row.updated_at) * 1000)
	};
}

async function hydrateTicketMessages(row: DBTicket, env: any): Promise<TicketMessage[]> {
	const masterKey = env.MASTER_KEY;
	const sections = await readTicketSections(row, masterKey);
	if (!sections.messages || sections.messages.length === 0) {
		return [];
	}

	const attachments = sections.attachments || [];
	const history = sections.history || [];
	const messages: TicketMessage[] = [];

	for (let index = 0; index < sections.messages.length; index += 1) {
		const storedMessage = sections.messages[index];
		if (!storedMessage) {
			continue;
		}

		const storedAttachments = attachments[index] ?? null;
		const ticketAttachments = storedAttachments
			? storedAttachments.map(fromStoredTicketAttachment)
			: undefined;
		const storedHistory = history[index] ?? null;
		const editHistory = storedHistory ? storedHistory.map(fromStoredMessageVersion) : undefined;
		messages.push(fromStoredTicketMessage(storedMessage, row, ticketAttachments, editHistory));
	}

	return messages;
}

async function hydrateTicketThread(row: DBTicket, env: any): Promise<TicketThread> {
	const ticket = await hydrateTicket(row, env);
	const messages = await hydrateTicketMessages(row, env);
	const participants = new Map<string, User | TicketActor>();

	for (const assignee of ticket.assignees) {
		participants.set(`user:${assignee.id}`, assignee);
	}

	for (const message of messages) {
		if (message.sender.kind === 'user') {
			const fullUser = await getUserById(message.sender.id, env);
			participants.set(`user:${message.sender.id}`, fullUser ?? message.sender);
		} else {
			participants.set(`customer:${message.sender.id}`, message.sender);
		}
	}

	// timeline events (renames/field changes/etc), sorted asc; client interleaves with messages
	const events = await getTicketEvents(ticket.id);

	return {
		ticket,
		messages,
		users: Array.from(participants.values()),
		events
	};
}

function toTicketAttachmentInput(
	attachment: TicketAttachmentInput,
	ticketId: number,
	attachmentId: number
): TicketAttachment {
	return {
		id: attachmentId,
		ticket_id: ticketId,
		data: attachment.data,
		file_name: attachment.file_name,
		mimetype: attachment.mimetype,
		created_at: new Date()
	};
}

// #endregion

// #region timeline events

// github-issue-style timeline lives in kv (no schema change); never in the encrypted messages
// array, so the message id===index invariant is preserved
const EVENTS_PREFIX = 'smoke:ticket_events:';
const eventsKey = (id: number) => `${EVENTS_PREFIX}${id}`;

// who/what drove a change; a flow takes precedence over a raw actor id
type EventAttribution = {
	actor?: Extract<TicketActor, { kind: 'user' }>;
	flow_id?: number;
	flow_name?: string;
};

// a single detected field change; kind is set only when it maps to a timeline event
type TicketChange = {
	kind?: TicketEventKind;
	field: string;
	from?: string;
	to?: string;
	label?: string;
};

export async function getTicketEvents(ticketId: number): Promise<TicketEvent[]> {
	try {
		const raw = await kv.get<TicketEvent[]>(eventsKey(ticketId), 'json');
		if (!Array.isArray(raw)) return [];
		// stable sort keeps insertion order among ties (events emitted in the same patch)
		return raw
			.map((e) => ({ ...e, created_at: new Date(e.created_at) }))
			.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
	} catch {
		return [];
	}
}

// append a timeline event (best-effort; never throws so it can't break the mutation that emits it)
export async function addTicketEvent(
	ticketId: number,
	event: Omit<TicketEvent, 'id' | 'created_at'> & { created_at?: Date },
	_env?: any
): Promise<TicketEvent> {
	const full: TicketEvent = {
		...event,
		id: crypto.randomUUID(),
		created_at: event.created_at ?? new Date()
	};
	try {
		const raw = await kv.get<TicketEvent[]>(eventsKey(ticketId), 'json');
		const existing = Array.isArray(raw) ? raw : [];
		await kv.set(eventsKey(ticketId), JSON.stringify([...existing, full]));
	} catch {
		// timeline persistence is best-effort
	}
	return full;
}

async function deleteTicketEvents(ticketId: number): Promise<void> {
	await kv.del(eventsKey(ticketId)).catch(() => {});
}

// resolve who drove a change into an attribution the timeline can render
async function resolveEventAttribution(
	options: { actorId?: string; actorFlow?: { id: number; name: string } },
	env: any
): Promise<EventAttribution> {
	if (options.actorFlow) {
		return { flow_id: options.actorFlow.id, flow_name: options.actorFlow.name };
	}
	if (options.actorId) {
		try {
			const u = await getUserById(options.actorId, env);
			if (u) {
				return {
					actor: {
						kind: 'user',
						id: u.id,
						username: u.username,
						email: u.email,
						name: u.name,
						avatar_url: u.avatar_url,
						role: u.role
					}
				};
			}
		} catch {
			// actor resolution is best-effort
		}
	}
	return {};
}

async function labelDisplayName(labelId: number): Promise<string | undefined> {
	try {
		const label = await getLabelById(labelId);
		return label?.name;
	} catch {
		return undefined;
	}
}

async function assigneeDisplayName(userId: string, env: any): Promise<string | undefined> {
	try {
		const user = await getUserById(userId, env);
		if (!user) return undefined;
		return displayName(user) || user.username;
	} catch {
		return undefined;
	}
}

// diff a ticket's before/after state into a change set (used for both timeline events + audit)
async function computeTicketChanges(
	beforeRow: DBTicket,
	beforeMeta: TicketMeta,
	after: Ticket,
	env: any
): Promise<TicketChange[]> {
	const changes: TicketChange[] = [];

	if (beforeRow.title !== after.title) {
		changes.push({ kind: 'renamed', field: 'title', from: beforeRow.title, to: after.title });
	}
	// description edits are audited but have no timeline event (no kind)
	if (beforeRow.description !== after.description) {
		changes.push({ field: 'description' });
	}

	const beforeStatus = String(beforeRow.status);
	if (beforeStatus !== after.status) {
		const closedSet = [TicketStatus.Closed, TicketStatus.WontFix] as string[];
		const wasClosed = closedSet.includes(beforeStatus);
		const nowClosed = closedSet.includes(after.status);
		// close/reopen transitions get their own kind; other status moves are a generic 'status'
		if (!wasClosed && nowClosed) {
			changes.push({ kind: 'closed', field: 'status', from: beforeStatus, to: after.status });
		} else if (wasClosed && !nowClosed) {
			changes.push({ kind: 'reopened', field: 'status', from: beforeStatus, to: after.status });
		} else {
			changes.push({ kind: 'status', field: 'status', from: beforeStatus, to: after.status });
		}
	}

	if (String(beforeRow.priority) !== after.priority) {
		changes.push({
			kind: 'priority',
			field: 'priority',
			from: String(beforeRow.priority),
			to: after.priority
		});
	}

	const beforeVis =
		(beforeMeta.visibility as TicketVisibility) ??
		(beforeRow.private === 1 ? TicketVisibility.Private : TicketVisibility.Public);
	if (beforeVis !== after.visibility) {
		changes.push({
			kind: 'visibility',
			field: 'visibility',
			from: beforeVis,
			to: after.visibility
		});
	}

	const beforeDeadline = beforeMeta.deadline ?? null;
	const afterDeadline = after.deadline ? after.deadline.toISOString() : null;
	if (beforeDeadline !== afterDeadline) {
		changes.push({
			kind: 'deadline',
			field: 'deadline',
			from: beforeDeadline ?? undefined,
			to: afterDeadline ?? undefined
		});
	}

	const beforeColor = beforeMeta.color ?? null;
	const afterColor = after.color ?? null;
	if (beforeColor !== afterColor) {
		changes.push({
			kind: 'color',
			field: 'color',
			from: beforeColor ?? undefined,
			to: afterColor ?? undefined
		});
	}

	const beforeIcon = beforeMeta.icon ?? null;
	const afterIcon = after.icon ?? null;
	if (beforeIcon !== afterIcon) {
		changes.push({
			kind: 'icon',
			field: 'icon',
			from: beforeIcon ?? undefined,
			to: afterIcon ?? undefined
		});
	}

	const beforeLocked = beforeMeta.locked === true;
	const afterLocked = after.locked === true;
	if (beforeLocked !== afterLocked) {
		changes.push({ kind: afterLocked ? 'locked' : 'unlocked', field: 'locked' });
	}

	const beforeArchived = beforeMeta.archived === true;
	const afterArchived = after.archived === true;
	if (beforeArchived !== afterArchived) {
		changes.push({ kind: afterArchived ? 'archived' : 'unarchived', field: 'archived' });
	}

	if (Number(beforeRow.customer_id) !== after.customer_id) {
		let toLabel: string | undefined;
		try {
			if (after.customer_id > 0) {
				const customer = await getCustomerById(after.customer_id, env);
				toLabel = customer?.name || customer?.email;
			}
		} catch {
			// name resolution is best-effort
		}
		changes.push({
			kind: 'customer_changed',
			field: 'customer_id',
			from: String(beforeRow.customer_id),
			to: String(after.customer_id),
			...(toLabel ? { label: toLabel } : {})
		});
	}

	const beforeLabels = parseCsvNumberList(beforeRow.labels);
	const afterLabels = after.labels ?? [];
	for (const labelId of afterLabels.filter((l) => !beforeLabels.includes(l))) {
		changes.push({
			kind: 'label_added',
			field: 'labels',
			to: String(labelId),
			label: await labelDisplayName(labelId)
		});
	}
	for (const labelId of beforeLabels.filter((l) => !afterLabels.includes(l))) {
		changes.push({
			kind: 'label_removed',
			field: 'labels',
			to: String(labelId),
			label: await labelDisplayName(labelId)
		});
	}

	const beforeAssignees = parseCsvStringList(beforeRow.assignees);
	const afterAssignees = after.assignees.map((a) => a.id);
	for (const uid of afterAssignees.filter((a) => !beforeAssignees.includes(a))) {
		changes.push({
			kind: 'assignee_added',
			field: 'assignees',
			to: uid,
			label: await assigneeDisplayName(uid, env)
		});
	}
	for (const uid of beforeAssignees.filter((a) => !afterAssignees.includes(a))) {
		changes.push({
			kind: 'assignee_removed',
			field: 'assignees',
			to: uid,
			label: await assigneeDisplayName(uid, env)
		});
	}

	// projects carry the id only; the client resolves names (getProjectById isn't shard-agnostic here)
	const beforeProjects = Array.isArray(beforeMeta.project_ids)
		? beforeMeta.project_ids
		: beforeMeta.project_id != null
			? [beforeMeta.project_id]
			: [];
	const afterProjects = after.project_ids ?? [];
	for (const pid of afterProjects.filter((p) => !beforeProjects.includes(p))) {
		changes.push({ kind: 'project_added', field: 'projects', to: String(pid) });
	}
	for (const pid of beforeProjects.filter((p) => !afterProjects.includes(p))) {
		changes.push({ kind: 'project_removed', field: 'projects', to: String(pid) });
	}

	return changes;
}

// emit a timeline event per change (with attribution) + one audit row summarizing the whole set
async function recordTicketChanges(
	ticketId: number,
	changes: TicketChange[],
	attribution: EventAttribution,
	options: { actorId?: string },
	env: any
): Promise<void> {
	if (changes.length === 0) return;
	try {
		for (const change of changes) {
			if (!change.kind) continue;
			await addTicketEvent(
				ticketId,
				{
					kind: change.kind,
					...(attribution.actor ? { actor: attribution.actor } : {}),
					...(attribution.flow_id != null ? { flow_id: attribution.flow_id } : {}),
					...(attribution.flow_name ? { flow_name: attribution.flow_name } : {}),
					...(change.from !== undefined ? { from: change.from } : {}),
					...(change.to !== undefined ? { to: change.to } : {}),
					...(change.label ? { label: change.label } : {})
				},
				env
			);
		}
	} catch {
		// timeline emission must never break a patch
	}

	// audit context stays non-pii: field names + from/to only for enum-ish/reference fields
	const safeFields = new Set([
		'status',
		'priority',
		'visibility',
		'locked',
		'archived',
		'deadline',
		'color',
		'icon',
		'customer_id',
		'labels',
		'assignees',
		'projects'
	]);
	await recordAudit(env, {
		action: 'ticket.updated',
		actorId: options.actorId,
		actorName: attribution.actor
			? displayName(attribution.actor) || attribution.actor.username
			: attribution.flow_name
				? `Flow: ${attribution.flow_name}`
				: undefined,
		targetType: 'ticket',
		targetId: ticketId,
		ticketId,
		summary: `Updated ticket #${ticketId} (${[...new Set(changes.map((c) => c.field))].join(', ')})`,
		context: {
			fields: [...new Set(changes.map((c) => c.field))],
			changes: changes
				.filter((c) => safeFields.has(c.field))
				.map((c) => ({
					field: c.field,
					...(c.from !== undefined ? { from: c.from } : {}),
					...(c.to !== undefined ? { to: c.to } : {}),
					...(c.label ? { label: c.label } : {})
				}))
		}
	});
}

// #endregion

// #region crud

async function getTicketRowById(id: number): Promise<DBTicket | null> {
	return await firstRow<DBTicket>(id.toString(), `SELECT * FROM tickets WHERE id = ?`, [id]);
}

export async function createTicket(
	input: TicketCreateInput,
	env: any,
	options: { actorId?: string; actorFlow?: { id: number; name: string } } = {}
): Promise<Ticket> {
	ensureCollegeDB(env);

	// validate custom-field values against the defined fields (only when the caller supplies them,
	// so internal creates - inbound email, flows - aren't blocked by required customs)
	if (input.custom_fields !== undefined) {
		validateCustomFieldValues(await listCustomFields(), input.custom_fields);
	}

	const maxRow = await first<{ id: number }>(
		'tickets',
		`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM tickets`,
		[]
	);
	const nextId = Number(maxRow?.id ?? 1);
	const nowSeconds = Math.floor(Date.now() / 1000);

	const labels = joinCsvNumberList(input.labels);
	const assignees = joinCsvStringList(input.assignee_ids);

	// resolve visibility: explicit wins, then the legacy private flag, then the per-source default
	// (only when a source is given), else public so existing callers keep their old behavior
	let visibility: TicketVisibility;
	if (input.visibility) visibility = input.visibility;
	else if (input.private === true) visibility = TicketVisibility.Private;
	else if (input.private === false) visibility = TicketVisibility.Public;
	else if (input.source) visibility = await defaultVisibilityFor(input.source);
	else visibility = TicketVisibility.Public;
	const privateCol = visibilityToPrivate(visibility);

	// 0 = customer-less internal ticket (e.g. bug tracking)
	const customerId = input.customer_id ?? 0;

	await run(
		String(nextId),
		`INSERT INTO tickets (
			id, title, created_at, updated_at, description, customer_id, status, priority, labels, assignees, private
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			nextId,
			input.title,
			nowSeconds,
			nowSeconds,
			input.description,
			customerId,
			input.status ?? TicketStatus.Open,
			input.priority ?? TicketPriority.None,
			labels,
			assignees,
			privateCol
		]
	);

	const projectIds = resolveProjectIds(input);
	await setTicketMeta(nextId, {
		visibility,
		color: input.color ?? null,
		icon: input.icon ?? null,
		deadline: normalizeDeadline(input.deadline),
		project_id: projectIds[0] ?? null,
		project_ids: projectIds,
		custom_fields: input.custom_fields ?? {},
		...(input.created_by ? { created_by: input.created_by } : {}),
		...(input.locked === true ? { locked: true } : {}),
		...(input.archived === true ? { archived: true, archived_at: new Date().toISOString() } : {})
	});

	const createdRow = await getTicketRowById(nextId);
	if (!createdRow) {
		throw createError({
			statusCode: 500,
			message: 'Failed to retrieve created ticket'
		});
	}

	const ticket = await hydrateTicket(createdRow, env);

	// timeline 'created' event + audit, attributed to the actor (or flow) that opened it
	const attribution = await resolveEventAttribution(options, env);
	await addTicketEvent(
		nextId,
		{
			kind: 'created',
			...(attribution.actor ? { actor: attribution.actor } : {}),
			...(attribution.flow_id != null ? { flow_id: attribution.flow_id } : {}),
			...(attribution.flow_name ? { flow_name: attribution.flow_name } : {})
		},
		env
	);
	await recordAudit(env, {
		action: 'ticket.created',
		actorId: options.actorId,
		actorName: attribution.actor
			? displayName(attribution.actor) || attribution.actor.username
			: attribution.flow_name
				? `Flow: ${attribution.flow_name}`
				: undefined,
		targetType: 'ticket',
		targetId: nextId,
		ticketId: nextId,
		summary: `Created ticket #${nextId}: ${input.title}`,
		context: { title: input.title, visibility, customer_id: customerId }
	});

	// fire automation flows; never let a flow error break ticket creation
	const customerEmail = customerId ? (await getCustomerById(customerId, env))?.email : undefined;
	await runTicketFlows(
		{ trigger: 'ticket.created', ticket, customer_email: customerEmail },
		env
	).catch(() => {});
	return ticket;
}

// accept a Date, iso string, or null; store as an iso string in meta
function normalizeDeadline(value: Date | string | null | undefined): string | null {
	if (value == null || value === '') return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// resolve a ticket's projects from input; project_ids wins, then the legacy single project_id
function resolveProjectIds(input: {
	project_ids?: number[];
	project_id?: number | null;
}): number[] {
	if (Array.isArray(input.project_ids)) {
		return [...new Set(input.project_ids.filter((n) => Number.isFinite(n) && n > 0))];
	}
	if (input.project_id != null) return [input.project_id];
	return [];
}

export async function patchTicket(
	id: number,
	updates: TicketPatchInput,
	env: any,
	options: {
		skipFlows?: boolean;
		actorId?: string;
		actorFlow?: { id: number; name: string };
	} = {}
): Promise<Ticket> {
	ensureCollegeDB(env);

	// validate custom-field values on patch when the caller changes them
	if (updates.custom_fields !== undefined) {
		validateCustomFieldValues(await listCustomFields(), updates.custom_fields);
	}

	// snapshot the FULL before state (row + meta) so we can diff for triggers + timeline events;
	// captured unconditionally (meta must be read before setTicketMeta overwrites it)
	const beforeRow = await getTicketRowById(id);
	const beforeMeta = beforeRow ? await getTicketMeta(id) : {};
	const beforeLabels = beforeRow ? parseCsvNumberList(beforeRow.labels) : [];
	const beforeAssignees = beforeRow ? parseCsvStringList(beforeRow.assignees) : [];

	const fields: string[] = [];
	const bindings: Array<string | number | null> = [];

	if (updates.title !== undefined) {
		fields.push('title = ?');
		bindings.push(updates.title);
	}

	if (updates.description !== undefined) {
		fields.push('description = ?');
		bindings.push(updates.description);
	}

	if (updates.customer_id !== undefined) {
		fields.push('customer_id = ?');
		bindings.push(updates.customer_id);
	}

	if (updates.status !== undefined) {
		fields.push('status = ?');
		bindings.push(updates.status);
	}

	if (updates.priority !== undefined) {
		fields.push('priority = ?');
		bindings.push(updates.priority);
	}

	if (updates.labels !== undefined) {
		fields.push('labels = ?');
		bindings.push(joinCsvNumberList(updates.labels));
	}

	if (updates.assignee_ids !== undefined) {
		fields.push('assignees = ?');
		bindings.push(joinCsvStringList(updates.assignee_ids));
	}

	// visibility is the source of truth; keep the legacy private column in sync when it changes
	if (updates.visibility !== undefined) {
		fields.push('private = ?');
		bindings.push(visibilityToPrivate(updates.visibility));
	} else if (updates.private !== undefined) {
		fields.push('private = ?');
		bindings.push(updates.private ? 1 : 0);
	}

	// per-ticket metadata patches live in kv, not columns
	const metaPatch: TicketMeta = {};
	if (updates.visibility !== undefined) metaPatch.visibility = updates.visibility;
	else if (updates.private !== undefined)
		metaPatch.visibility = updates.private ? TicketVisibility.Private : TicketVisibility.Public;
	if (updates.color !== undefined) metaPatch.color = updates.color;
	if (updates.icon !== undefined) metaPatch.icon = updates.icon;
	if (updates.deadline !== undefined) metaPatch.deadline = normalizeDeadline(updates.deadline);
	if (updates.project_ids !== undefined || updates.project_id !== undefined) {
		const ids = resolveProjectIds(updates);
		metaPatch.project_ids = ids;
		metaPatch.project_id = ids[0] ?? null;
	}
	if (updates.custom_fields !== undefined) metaPatch.custom_fields = updates.custom_fields;
	if (updates.locked !== undefined) metaPatch.locked = updates.locked;
	if (updates.archived !== undefined) {
		metaPatch.archived = updates.archived;
		metaPatch.archived_at = updates.archived ? new Date().toISOString() : null;
	}
	// auto-lock the thread on close when the owner enabled it and didn't set locked explicitly
	if (updates.status === TicketStatus.Closed && updates.locked === undefined) {
		const locking = await getLockingSettings();
		if (locking.auto_lock_on_close) metaPatch.locked = true;
	}
	const hasMetaPatch = Object.keys(metaPatch).length > 0;

	if (fields.length === 0 && !hasMetaPatch) {
		throw createError({
			statusCode: 400,
			message: 'No valid fields to update'
		});
	}

	const updatedAt = Math.floor(Date.now() / 1000);

	if (fields.length > 0) {
		await run(
			id.toString(),
			`UPDATE tickets SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`,
			[...bindings, updatedAt, id]
		);
	} else {
		await run(id.toString(), `UPDATE tickets SET updated_at = ? WHERE id = ?`, [updatedAt, id]);
	}

	if (hasMetaPatch) await setTicketMeta(id, metaPatch);

	const updatedRow = await getTicketRowById(id);
	if (!updatedRow) {
		throw createError({
			statusCode: 500,
			message: 'Failed to retrieve updated ticket'
		});
	}

	await invalidateTicketCache(id);
	const ticket = await hydrateTicket(updatedRow, env);

	// timeline events + audit run regardless of skipFlows (a flow-driven patch still gets recorded,
	// attributed to the flow); a raw actor id attributes to the acting user
	if (beforeRow) {
		const attribution = await resolveEventAttribution(options, env);
		const changes = await computeTicketChanges(beforeRow, beforeMeta, ticket, env);
		await recordTicketChanges(id, changes, attribution, { actorId: options.actorId }, env);
	}

	// skipFlows prevents infinite recursion when a flow action patches the ticket
	if (!options.skipFlows) {
		await runTicketFlows({ trigger: 'ticket.updated', ticket }, env).catch(() => {});
		// attaching a customer to a ticket is its own trigger
		if (updates.customer_id !== undefined && updates.customer_id > 0) {
			const cust = await getCustomerById(updates.customer_id, env);
			await runTicketFlows(
				{
					trigger: 'customer.added',
					ticket,
					customer: cust
						? { id: cust.id, email: cust.email, name: cust.name }
						: { id: updates.customer_id },
					customer_email: cust?.email
				},
				env
			).catch(() => {});
		}
		// per-label + per-assignee add/remove triggers, diffed against the pre-write snapshot
		await fireLabelAssigneeDiffs(ticket, beforeLabels, beforeAssignees, env);

		// lifecycle notifications (close/reopen/archive) for non-email-thread tickets
		if (beforeRow) {
			const closed = [TicketStatus.Closed, TicketStatus.WontFix];
			const wasClosed = closed.includes(normalizeTicketStatus(beforeRow.status));
			const nowClosed = closed.includes(ticket.status);
			if (!wasClosed && nowClosed) await notifyTicketEvent('closed', ticket, env).catch(() => {});
			else if (wasClosed && !nowClosed)
				await notifyTicketEvent('reopened', ticket, env).catch(() => {});
		}
		if (updates.archived === true) {
			await notifyTicketEvent('archived', ticket, env).catch(() => {});
		}
	}
	return ticket;
}

// fire label.added/removed + assignee.added/removed for each changed member (best-effort)
async function fireLabelAssigneeDiffs(
	ticket: Ticket,
	beforeLabels: number[],
	beforeAssignees: string[],
	env: any
): Promise<void> {
	try {
		const afterLabels = ticket.labels ?? [];
		const afterAssignees = ticket.assignees.map((a) => a.id);

		const addedLabels = afterLabels.filter((l) => !beforeLabels.includes(l));
		const removedLabels = beforeLabels.filter((l) => !afterLabels.includes(l));
		const addedAssignees = afterAssignees.filter((a) => !beforeAssignees.includes(a));
		const removedAssignees = beforeAssignees.filter((a) => !afterAssignees.includes(a));

		for (const labelId of [...addedLabels, ...removedLabels]) {
			const label = await getLabelById(labelId).catch(() => null);
			await runTicketFlows(
				{
					trigger: addedLabels.includes(labelId) ? 'label.added' : 'label.removed',
					ticket,
					label: label
						? { id: label.id, name: label.name, color: label.color }
						: { id: labelId, name: String(labelId) }
				},
				env
			).catch(() => {});
		}

		for (const userId of [...addedAssignees, ...removedAssignees]) {
			const u = await getUserById(userId, env).catch(() => null);
			await runTicketFlows(
				{
					trigger: addedAssignees.includes(userId) ? 'assignee.added' : 'assignee.removed',
					ticket,
					assignee: u
						? { id: u.id, username: u.username, name: u.name }
						: { id: userId, username: userId }
				},
				env
			).catch(() => {});
		}
	} catch {
		// diffing must never break a patch
	}
}

export async function deleteTicket(
	id: number,
	env: any,
	options: { actorId?: string } = {}
): Promise<void> {
	ensureCollegeDB(env);
	// fire the delete trigger with a final snapshot before the row is gone
	const existing = await getTicketRowById(id);
	if (existing) {
		const ticket = await hydrateTicket(existing, env);
		await runTicketFlows({ trigger: 'ticket.deleted', ticket }, env).catch(() => {});
		await notifyTicketEvent('deleted', ticket, env).catch(() => {});
		await recordAudit(env, {
			action: 'ticket.deleted',
			actorId: options.actorId,
			targetType: 'ticket',
			targetId: id,
			ticketId: id,
			priority: 'high',
			summary: `Deleted ticket #${id}: ${ticket.title}`,
			context: { title: ticket.title, status: ticket.status, customer_id: ticket.customer_id }
		});
	}
	await run(id.toString(), `DELETE FROM tickets WHERE id = ?`, [id]);
	await deleteTicketMeta(id);
	await deleteTicketEvents(id);
	await invalidateTicketCache(id);
}

export async function listTickets(
	env: any,
	search: string,
	page: number,
	limit: number,
	offset: number,
	sort: keyof DBTicket,
	sort_direction: 'asc' | 'desc',
	current: User | null = null
): Promise<Ticket[]> {
	ensureCollegeDB(env);

	const cacheKey = `${TICKET_LIST_PREFIX}${search}:${page}:${limit}:${sort}:${sort_direction}`;
	return await cache(cacheKey, async () => {
		const bindings: Array<string | number> = [];
		const clauses: string[] = [];

		if (search) {
			clauses.push('(title LIKE ? OR description LIKE ?)');
			bindings.push(`%${search}%`, `%${search}%`);
		}

		if (!current) {
			clauses.push('private = 0');
		} else if (!current.permissions.includes(Permission.ViewPrivateTickets)) {
			clauses.push('(private = 0 OR assignees LIKE ?)');
			bindings.push(`%${current.id}%`);
		}

		const sql = `SELECT * FROM tickets${clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''}`;

		const result = await allAllShardsGlobal<DBTicket>(sql, bindings, {
			sortBy: sort as keyof DBTicket,
			sortDirection: sort_direction as 'asc' | 'desc',
			offset,
			limit
		});

		return await Promise.all(
			result.results.map(async (ticket) => await hydrateTicket(ticket, env))
		);
	});
}

export async function getTicketById(
	id: number,
	env: any,
	current: User | null = null
): Promise<Ticket | null> {
	ensureCollegeDB(env);
	const hydrated = await cache(
		ticketIdKey(id),
		async () => {
			const row = await getTicketRowById(id);
			if (!row) return null;
			return await hydrateTicket(row, env);
		},
		300
	);

	if (!hydrated) return null;
	if (!canViewPrivateTicket(current, hydrated)) return null;

	return hydrated;
}

async function invalidateTicketCache(id: number): Promise<void> {
	// a ticket write also shifts the list + the ticket-derived analytics summary
	await invalidateTicket(id);
}

export async function getTicketsByPriority(priority: TicketPriority, env: any): Promise<Ticket[]> {
	ensureCollegeDB(env);
	const result = await allAllShardsGlobal<DBTicket>(
		`SELECT * FROM tickets WHERE priority = ? ORDER BY created_at DESC`,
		[priority]
	);
	return await Promise.all(result.results.map(async (ticket) => await hydrateTicket(ticket, env)));
}

export async function addTicketMessage(
	ticketId: number,
	input: TicketMessageInput,
	env: any
): Promise<TicketMessage> {
	ensureCollegeDB(env);

	const ticket = await getTicketRowById(ticketId);
	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found'
		});
	}

	const sections = await readTicketSections(ticket, env.MASTER_KEY);
	const messages = sections.messages ? [...sections.messages] : [];
	const attachments = sections.attachments
		? [...sections.attachments]
		: Array.from(
				{
					length: messages.length
				},
				() => null
			);
	const history = sections.history
		? [...sections.history]
		: Array.from(
				{
					length: messages.length
				},
				() => null
			);
	const messageId = messages.length;

	let sender = input.sender;
	// only backfill from the db when the caller gave a bare user id; self/team/automation/ai
	// senders arrive fully-formed and must survive verbatim (incl. role/ai tags + anonymized team)
	if (sender.kind === 'user' && !sender.username) {
		const hydratedUser = await getUserById(sender.id, env);
		if (hydratedUser) {
			sender = {
				kind: 'user',
				id: hydratedUser.id,
				username: hydratedUser.username,
				email: hydratedUser.email,
				name: hydratedUser.name,
				avatar_url: hydratedUser.avatar_url,
				role: hydratedUser.role
			};
		}
	}

	const attachmentEntries = (input.attachments || []).map((attachment, index) =>
		toTicketAttachmentInput(attachment, ticketId, index)
	);

	const ticketMessage: TicketMessage = {
		id: messageId,
		ticket_id: ticketId,
		reply_to: input.reply_to,
		sender,
		sender_id: sender.id.toString(),
		private: sender.kind === 'customer' ? false : (input.private ?? false),
		message: input.message,
		created_at: new Date(),
		attachments: attachmentEntries.length > 0 ? attachmentEntries : undefined
	};

	messages.push(toStoredTicketMessage(ticketMessage));
	attachments.push(
		attachmentEntries.length > 0 ? attachmentEntries.map(toStoredTicketAttachment) : null
	);
	// a brand-new message has no prior versions yet
	history.push(null);

	await writeTicketSections(ticketId, messages, attachments, history, env);

	// fire the message-trigger flows; customer_email comes free from a customer sender
	const customerEmail = sender.kind === 'customer' ? sender.email : undefined;
	const hydrated = await hydrateTicket(ticket, env);
	await runTicketFlows(
		{
			trigger: 'ticket.message',
			ticket: hydrated,
			customer_email: customerEmail
		},
		env
	).catch(() => {});

	// notify the other participants about the new message (no-op for email-thread tickets + the actor)
	await notifyTicketEvent('message', hydrated, env, {
		actorId: sender.kind === 'user' ? sender.id : undefined,
		message: input.message
	}).catch(() => {});

	await recordAudit(env, {
		action: 'ticket.message_added',
		actorId: sender.kind === 'user' ? sender.id : undefined,
		actorName: sender.name || (sender.kind === 'user' ? sender.username : sender.email),
		targetType: 'ticket',
		targetId: ticketId,
		ticketId,
		summary: `Added a message to ticket #${ticketId}`,
		context: {
			message_id: messageId,
			sender_kind: sender.kind,
			private: ticketMessage.private,
			attachments: attachmentEntries.length
		}
	});

	return ticketMessage;
}

export async function getTicketThread(
	id: number,
	env: any,
	current: User | null = null,
	options: { bypassGate?: boolean } = {}
): Promise<TicketThread> {
	ensureCollegeDB(env);

	const ticket = await getTicketRowById(id);
	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found'
		});
	}

	const thread = await hydrateTicketThread(ticket, env);
	// bypassGate is used by token-authorized public access, where the status token IS the credential
	if (!options.bypassGate && !canViewPrivateTicket(current, thread.ticket)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to view this ticket'
		});
	}

	return thread;
}

export async function listTicketMessages(
	id: number,
	env: any,
	search: string,
	sort: keyof Omit<TicketMessage, 'attachments' | 'ticket_id' | 'sender'>,
	sort_direction: 'asc' | 'desc',
	current: User | null = null
): Promise<TicketMessage[]> {
	const thread = await getTicketThread(id, env, current);
	return thread.messages
		.filter((message) => {
			if (!search) return true;
			const lowerSearch = search.toLowerCase();
			return (
				message.message.toLowerCase().includes(lowerSearch) ||
				(message.sender.kind === 'user' &&
					(message.sender.username.toLowerCase().includes(lowerSearch) ||
						message.sender.email?.toLowerCase().includes(lowerSearch) ||
						(message.sender.name && message.sender.name.toLowerCase().includes(lowerSearch))))
			);
		})
		.sort((a, b) => {
			const fieldA = (a[sort]?.toString() || '').toLowerCase();
			const fieldB = (b[sort]?.toString() || '').toLowerCase();
			if (fieldA < fieldB) return sort_direction === 'asc' ? -1 : 1;
			if (fieldA > fieldB) return sort_direction === 'asc' ? 1 : -1;

			return 0;
		});
}

export async function getTicketMessage(
	ticketId: number,
	messageId: number,
	env: any,
	current: User | null = null
): Promise<TicketMessage> {
	const thread = await getTicketThread(ticketId, env, current);
	const message = thread.messages.find((msg) => msg.id === messageId);
	if (!message) {
		throw createError({
			statusCode: 404,
			message: 'Ticket message not found'
		});
	}

	return message;
}

export async function editTicketMessage(
	ticketId: number,
	messageId: number,
	content: string,
	attachments: TicketAttachmentInput[] | undefined,
	env: any,
	editorId?: string
): Promise<TicketMessage> {
	ensureCollegeDB(env);

	const ticket = await getTicketRowById(ticketId);
	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found'
		});
	}

	const sections = await readTicketSections(ticket, env.MASTER_KEY);
	const messages = sections.messages ? [...sections.messages] : [];
	if (messageId < 0 || messageId >= messages.length || !messages[messageId]) {
		throw createError({
			statusCode: 404,
			message: 'Ticket message not found'
		});
	}

	const oldAttachments = sections.attachments
		? [...sections.attachments]
		: Array.from(
				{
					length: messages.length
				},
				() => null
			);

	const history = sections.history
		? [...sections.history]
		: Array.from(
				{
					length: messages.length
				},
				() => null
			);

	const storedMessage = messages[messageId]!;
	const storedAttachments = oldAttachments[messageId] ?? null;

	const ticketAttachments = attachments
		? attachments.map((attachment, index) =>
				toTicketAttachmentInput(attachment, ticketId, messageId * 1000 + index)
			)
		: storedAttachments
			? storedAttachments.map(fromStoredTicketAttachment)
			: undefined;

	// stamp the editor only when a DIFFERENT staff member edits a staff message
	const editedBy =
		storedMessage.sender.kind === 'user' && storedMessage.sender.id !== editorId
			? (editorId ?? null)
			: null;

	const updatedMessage: TicketMessage = {
		id: storedMessage.id,
		ticket_id: storedMessage.ticket_id,
		reply_to: storedMessage.reply_to,
		sender: storedMessage.sender,
		sender_id: storedMessage.sender.id.toString(),
		private: ticket.private === 1,
		message: content,
		created_at: new Date(storedMessage.created_at),
		edited_at: new Date(),
		edited_by: editedBy,
		attachments: ticketAttachments
	};

	// snapshot the prior body into history (newest-last) before overwriting the message
	const priorVersions = history[messageId] ? [...history[messageId]!] : [];
	priorVersions.push({
		message: storedMessage.message,
		edited_at: storedMessage.edited_at ?? storedMessage.created_at,
		edited_by: storedMessage.edited_by ?? null
	});
	history[messageId] = priorVersions;

	messages[messageId] = toStoredTicketMessage(updatedMessage);
	oldAttachments[messageId] = ticketAttachments
		? ticketAttachments.map(toStoredTicketAttachment)
		: null;

	await writeTicketSections(ticketId, messages, oldAttachments, history, env);

	await recordAudit(env, {
		action: 'ticket.message_edited',
		actorId: editorId,
		targetType: 'ticket',
		targetId: ticketId,
		ticketId,
		summary: `Edited message #${messageId} on ticket #${ticketId}`,
		context: { message_id: messageId, versions: priorVersions.length }
	});

	// surface the prior versions on the returned message so the composer can diff immediately
	updatedMessage.edit_history = priorVersions.map(fromStoredMessageVersion);

	return updatedMessage;
}

export async function deleteTicketMessage(
	ticketId: number,
	messageId: number,
	env: any,
	options: { actorId?: string } = {}
): Promise<void> {
	ensureCollegeDB(env);

	const ticket = await getTicketRowById(ticketId);
	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found'
		});
	}

	const sections = await readTicketSections(ticket, env.MASTER_KEY);
	const messages = sections.messages ? [...sections.messages] : [];
	if (messageId < 0 || messageId >= messages.length || !messages[messageId]) {
		throw createError({
			statusCode: 404,
			message: 'Ticket message not found'
		});
	}

	const attachments = sections.attachments
		? [...sections.attachments]
		: Array.from(
				{
					length: messages.length
				},
				() => null
			);
	const history = sections.history
		? [...sections.history]
		: Array.from(
				{
					length: messages.length
				},
				() => null
			);
	messages[messageId] = null;
	attachments[messageId] = null;
	// drop the prior versions for the deleted slot too
	history[messageId] = null;

	await recordAudit(env, {
		action: 'ticket.message_deleted',
		actorId: options.actorId,
		targetType: 'ticket',
		targetId: ticketId,
		ticketId,
		summary: `Deleted message #${messageId} on ticket #${ticketId}`,
		context: { message_id: messageId }
	});

	if (messages.every((entry) => entry == null)) {
		await writeTicketSections(ticketId, null, null, null, env);
		return;
	}

	await writeTicketSections(ticketId, messages, attachments, history, env);
}

export async function clearTicketMessages(id: number, env: any): Promise<void> {
	ensureCollegeDB(env);

	const ticket = await getTicketRowById(id);
	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found'
		});
	}

	await writeTicketSections(id, null, null, null, env);
}

// #endregion

// #region ticket meta

// per-ticket metadata lives in kv (no db migration; mirrors the email-engine kv precedent).
// the `private` column is still derived from visibility so sql filters + public gating keep working
const META_PREFIX = 'smoke:ticket_meta:';

const key = (id: number) => `${META_PREFIX}${id}`;

export async function getTicketMeta(id: number): Promise<TicketMeta> {
	try {
		const raw = await kv.get<TicketMeta>(key(id), 'json');
		return raw && typeof raw === 'object' ? raw : {};
	} catch {
		return {};
	}
}

export async function setTicketMeta(id: number, patch: TicketMeta): Promise<TicketMeta> {
	const current = await getTicketMeta(id);
	const next: TicketMeta = { ...current };
	for (const [k, v] of Object.entries(patch)) {
		if (v !== undefined) (next as Record<string, unknown>)[k] = v;
	}
	await kv.set(key(id), JSON.stringify(next));
	return next;
}

export async function deleteTicketMeta(id: number): Promise<void> {
	await kv.del(key(id)).catch(() => {});
}

// visibility a ticket should default to given how it was opened; configurable in settings
export async function defaultVisibilityFor(source: TicketSource): Promise<TicketVisibility> {
	const defaults = await getVisibilityDefaults();
	return (defaults[source] as TicketVisibility) ?? TicketVisibility.Private;
}

// map visibility -> the legacy private column (public is the only non-private state for sql)
export function visibilityToPrivate(visibility: TicketVisibility): 0 | 1 {
	return visibility === TicketVisibility.Public ? 0 : 1;
}

// #endregion

// #region participants

// inverted index so the portal can list a customer's participant tickets without a full scan
const PARTICIPATIONS_PREFIX = 'smoke:customer_participations:';
const participationsKey = (customerId: number) => `${PARTICIPATIONS_PREFIX}${customerId}`;

function normalizeEmail(email: string): string {
	return (email ?? '').trim().toLowerCase();
}

// the extra emails (cc'd / forwarded) granted access to a ticket, from kv meta
export async function getTicketParticipants(ticketId: number): Promise<string[]> {
	const meta = await getTicketMeta(ticketId);
	return Array.isArray(meta.participants) ? meta.participants : [];
}

// the ticket ids a customer participates in (not owns); backs the portal "my requests" union
export async function listParticipantTicketIds(customerId: number): Promise<number[]> {
	if (!customerId || customerId <= 0) return [];
	try {
		const raw = await kv.get<number[]>(participationsKey(customerId), 'json');
		return Array.isArray(raw) ? raw.filter((id) => Number.isFinite(id)) : [];
	} catch {
		return [];
	}
}

async function addParticipation(customerId: number, ticketId: number): Promise<void> {
	const ids = await listParticipantTicketIds(customerId);
	if (ids.includes(ticketId)) return;
	await kv.set(participationsKey(customerId), JSON.stringify([...ids, ticketId]));
}

async function removeParticipation(customerId: number, ticketId: number): Promise<void> {
	const ids = await listParticipantTicketIds(customerId);
	const next = ids.filter((id) => id !== ticketId);
	if (next.length === ids.length) return;
	await kv.set(participationsKey(customerId), JSON.stringify(next));
}

// add an email to a ticket's participant allow-list; skips empty / the primary customer / dupes.
// ensures a customer exists for the email so the portal + inverted index can resolve it
export async function addTicketParticipant(
	ticketId: number,
	email: string,
	env: any,
	options: { actorId?: string } = {}
): Promise<{ added: boolean; participants: string[] }> {
	ensureCollegeDB(env);
	const normalized = normalizeEmail(email);
	const participants = await getTicketParticipants(ticketId);

	if (!normalized) return { added: false, participants };

	// never shadow the ticket's own customer as a participant (they're the primary)
	const row = await getTicketRowById(ticketId);
	const customerId = row ? Number(row.customer_id) : 0;
	if (customerId > 0) {
		const owner = await getCustomerById(customerId, env);
		if (owner?.email && normalizeEmail(owner.email) === normalized) {
			return { added: false, participants };
		}
	}

	if (participants.includes(normalized)) return { added: false, participants };

	const next = [...participants, normalized];
	await setTicketMeta(ticketId, { participants: next });

	const existing = await getCustomerByEmail(normalized, env);
	const customer =
		existing ?? (await createCustomer({ email: normalized, name: normalized, tags: [] }, env));
	await addParticipation(customer.id, ticketId);

	await invalidateTicketCache(ticketId);

	await recordAudit(env, {
		action: 'ticket.participant_added',
		actorId: options.actorId,
		targetType: 'ticket',
		targetId: ticketId,
		ticketId,
		summary: `Added participant to ticket #${ticketId}`,
		context: { customer_id: customer.id }
	});

	return { added: true, participants: next };
}

// remove an email from a ticket's participant allow-list + its inverted index (best-effort)
export async function removeTicketParticipant(
	ticketId: number,
	email: string,
	env: any,
	options: { actorId?: string } = {}
): Promise<{ participants: string[] }> {
	ensureCollegeDB(env);
	const normalized = normalizeEmail(email);
	const participants = await getTicketParticipants(ticketId);
	if (!normalized || !participants.includes(normalized)) return { participants };

	const next = participants.filter((entry) => entry !== normalized);
	await setTicketMeta(ticketId, { participants: next });

	let removedCustomerId: number | undefined;
	try {
		const customer = await getCustomerByEmail(normalized, env);
		if (customer) {
			removedCustomerId = customer.id;
			await removeParticipation(customer.id, ticketId);
		}
	} catch {
		// index cleanup must never break a remove
	}

	await invalidateTicketCache(ticketId);

	await recordAudit(env, {
		action: 'ticket.participant_removed',
		actorId: options.actorId,
		targetType: 'ticket',
		targetId: ticketId,
		ticketId,
		summary: `Removed participant from ticket #${ticketId}`,
		context: { customer_id: removedCustomerId ?? null }
	});

	return { participants: next };
}

// #endregion
