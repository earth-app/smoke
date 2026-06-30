import { allAllShardsGlobal, first, run } from '@earth-app/collegedb';
import { DBTicket, ensureCollegeDB } from 'hub:db:schema';

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
	'sender_id' | 'attachments' | 'created_at' | 'private'
> & {
	created_at: string;
};

type StoredTicketAttachment = {
	id: number;
	ticket_id: number;
	data: string;
	file_name: string;
	mimetype: string;
	created_at: string;
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
		created_at: message.created_at.toISOString()
	};
}

function fromStoredTicketMessage(
	message: StoredTicketMessage,
	ticket: DBTicket,
	attachments?: TicketAttachment[]
): TicketMessage {
	return {
		id: message.id,
		ticket_id: message.ticket_id,
		reply_to: message.reply_to,
		sender: message.sender,
		sender_id: message.sender.id.toString(),
		private: ticket.private === 1,
		message: message.message,
		created_at: new Date(message.created_at),
		attachments: attachments && attachments.length > 0 ? attachments : undefined
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

	return { messages, attachments };
}

async function writeTicketSections(
	id: number,
	messages: (StoredTicketMessage | null)[] | null,
	attachments: (StoredTicketAttachment[] | null)[] | null,
	env: any
): Promise<void> {
	const messagesEncrypted = messages ? await encrypt(messages, env.MASTER_KEY) : null;
	const attachmentsEncrypted = attachments ? await encrypt(attachments, env.MASTER_KEY) : null;
	const updatedAt = Math.floor(Date.now() / 1000);

	await run(
		id.toString(),
		`UPDATE tickets
		 SET messages_data = ?, messages_wrapped_dek = ?, messages_nonce = ?, messages_tag = ?, messages_algorithm = ?, messages_version = ?,
		     attachments_data = ?, attachments_wrapped_dek = ?, attachments_nonce = ?, attachments_tag = ?, attachments_algorithm = ?, attachments_version = ?,
		     updated_at = ?
		 WHERE id = ?`,
		[
			...ticketSectionBindings(messagesEncrypted),
			...ticketSectionBindings(attachmentsEncrypted),
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

	return {
		id: row.id,
		title: row.title,
		description: row.description,
		status: normalizeTicketStatus(row.status),
		priority: normalizeTicketPriority(row.priority),
		labels: parseCsvNumberList(row.labels),
		private: row.private === 1,
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
		messages.push(fromStoredTicketMessage(storedMessage, row, ticketAttachments));
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

	return {
		ticket,
		messages,
		users: Array.from(participants.values())
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

// #region crud

async function getTicketRowById(id: number): Promise<DBTicket | null> {
	return await first<DBTicket>(id.toString(), `SELECT * FROM tickets WHERE id = ?`, [id]);
}

export async function createTicket(input: TicketCreateInput, env: any): Promise<Ticket> {
	ensureCollegeDB(env);
	const maxRow = await first<{ id: number }>(
		'tickets',
		`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM tickets`,
		[]
	);
	const nextId = Number(maxRow?.id ?? 1);
	const nowSeconds = Math.floor(Date.now() / 1000);

	const labels = joinCsvNumberList(input.labels);
	const assignees = joinCsvStringList(input.assignee_ids);
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
			input.customer_id,
			input.status ?? TicketStatus.Open,
			input.priority ?? TicketPriority.None,
			labels,
			assignees,
			input.private ? 1 : 0
		]
	);

	const createdRow = await getTicketRowById(nextId);
	if (!createdRow) {
		throw createError({
			statusCode: 500,
			message: 'Failed to retrieve created ticket'
		});
	}

	return await hydrateTicket(createdRow, env);
}

export async function patchTicket(
	id: number,
	updates: TicketPatchInput,
	env: any
): Promise<Ticket> {
	ensureCollegeDB(env);

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

	if (updates.private !== undefined) {
		fields.push('private = ?');
		bindings.push(updates.private ? 1 : 0);
	}

	if (fields.length === 0) {
		throw createError({
			statusCode: 400,
			message: 'No valid fields to update'
		});
	}

	const updatedAt = Math.floor(Date.now() / 1000);

	await run(id.toString(), `UPDATE tickets SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`, [
		...bindings,
		updatedAt,
		id
	]);

	const updatedRow = await getTicketRowById(id);
	if (!updatedRow) {
		throw createError({
			statusCode: 500,
			message: 'Failed to retrieve updated ticket'
		});
	}

	await invalidateTicketCache(id);
	return await hydrateTicket(updatedRow, env);
}

export async function deleteTicket(id: number, env: any): Promise<void> {
	ensureCollegeDB(env);
	await run(id.toString(), `DELETE FROM tickets WHERE id = ?`, [id]);
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

	const cacheKey = `smoke:cache:tickets:${search}:${page}:${limit}:${sort}:${sort_direction}`;
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
		`smoke:cache:ticket_id:${id}`,
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
	await kv.del(`smoke:cache:ticket_id:${id}`);
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
	const messageId = messages.length;

	let sender = input.sender;
	if (sender.kind === 'user') {
		const hydratedUser = await getUserById(sender.id, env);
		if (hydratedUser) {
			sender = {
				kind: 'user',
				id: hydratedUser.id,
				username: hydratedUser.username,
				email: hydratedUser.email,
				name: hydratedUser.name,
				avatar_url: hydratedUser.avatar_url
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
		private: ticket.private === 1,
		message: input.message,
		created_at: new Date(),
		attachments: attachmentEntries.length > 0 ? attachmentEntries : undefined
	};

	messages.push(toStoredTicketMessage(ticketMessage));
	attachments.push(
		attachmentEntries.length > 0 ? attachmentEntries.map(toStoredTicketAttachment) : null
	);

	await writeTicketSections(ticketId, messages, attachments, env);

	return ticketMessage;
}

export async function getTicketThread(
	id: number,
	env: any,
	current: User | null = null
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
	if (!canViewPrivateTicket(current, thread.ticket)) {
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

	const storedMessage = messages[messageId]!;
	const storedAttachments = oldAttachments[messageId] ?? null;

	const ticketAttachments = attachments
		? attachments.map((attachment, index) =>
				toTicketAttachmentInput(attachment, ticketId, messageId * 1000 + index)
			)
		: storedAttachments
			? storedAttachments.map(fromStoredTicketAttachment)
			: undefined;

	const updatedMessage: TicketMessage = {
		id: storedMessage.id,
		ticket_id: storedMessage.ticket_id,
		reply_to: storedMessage.reply_to,
		sender: storedMessage.sender,
		sender_id: storedMessage.sender.id.toString(),
		private: ticket.private === 1,
		message: content,
		created_at: new Date(storedMessage.created_at),
		attachments: ticketAttachments
	};

	messages[messageId] = toStoredTicketMessage(updatedMessage);
	oldAttachments[messageId] = ticketAttachments
		? ticketAttachments.map(toStoredTicketAttachment)
		: null;

	await writeTicketSections(ticketId, messages, oldAttachments, env);

	return updatedMessage;
}

export async function deleteTicketMessage(
	ticketId: number,
	messageId: number,
	env: any
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
	messages[messageId] = null;
	attachments[messageId] = null;

	if (messages.every((entry) => entry == null)) {
		await writeTicketSections(ticketId, null, null, env);
		return;
	}

	await writeTicketSections(ticketId, messages, attachments, env);
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

	await writeTicketSections(id, null, null, env);
}
