import { first } from '@earth-app/collegedb';
import { DBTicket } from 'hub:db:schema';
import { createMimeMessage } from 'mimetext';
import PostalMime from 'postal-mime';

// #region types + constants

// keys that gate the crypto + threading layer; transport is resolved separately via getEmailConfig
const REQUIRED_ENV = ['MASTER_KEY', 'HMAC_SECRET'];

const MSGID_INDEX_TTL = 60 * 60 * 24 * 90;

// kv index mapping a linked agent mailbox hash -> user id (work mailbox != login email)
const agentEmailKey = (hash: string) => `smoke:agent_email:${hash}`;

export type SenderIdentity = 'self' | 'team';

type EmailThread = {
	subject: string;
	customer_email: string;
	last_message_id?: string;
	references: string[];
};

export type ParsedInboundEmail = {
	from: string;
	name?: string;
	to: string;
	subject: string;
	messageId?: string;
	inReplyTo?: string;
	references: string[];
	text: string;
	html?: string;
};

// #endregion

// #region config

// crypto/threading keys present and an outbound transport resolvable (custom smtp or cf email service)
export async function isEmailConfigured(env: any): Promise<boolean> {
	const hasKeys = REQUIRED_ENV.every(
		(key) => typeof env?.[key] === 'string' && env[key].length > 0
	);
	if (!hasKeys) return false;
	return (await getEmailConfig(env)) != null;
}

async function supportAddress(env: any): Promise<string> {
	const email = await getEmailSettings();
	return email.support_email || String(env?.SUPPORT_EMAIL ?? '');
}

async function siteUrl(env: any): Promise<string> {
	const email = await getEmailSettings();
	const url = email.site_url || env?.NUXT_PUBLIC_SITE_URL;
	return typeof url === 'string' && url.length > 0
		? url.replace(/\/$/, '')
		: 'https://smoke.pages.dev';
}

function domainOf(address: string): string {
	return String(address ?? '').split('@')[1] ?? 'localhost';
}

// #endregion

// #region kv keys + hashing

const msgidKey = (hash: string) => `smoke:email_msgid:${hash}`;
const threadKey = (ticketId: number) => `smoke:email_thread:${ticketId}`;

function normalizeMessageId(messageId: string): string {
	return messageId.trim().replace(/^<|>$/g, '').toLowerCase();
}

async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input));
	return bytesToHex(new Uint8Array(digest));
}

// #endregion

// #region inbound parsing

function parseReferenceList(value: unknown): string[] {
	if (!value) return [];
	return String(value)
		.split(/[\s,]+/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function htmlToText(html: string): string {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

// message is the cloudflare ForwardableEmailMessage; typed loose per the env: any convention
export async function parseInboundEmail(message: any): Promise<ParsedInboundEmail | null> {
	const buffer = await new Response(message.raw as BodyInit).arrayBuffer();
	const parsed = await PostalMime.parse(buffer);
	const headers = message.headers;

	const from = (message.from || parsed.from?.address || '').trim().toLowerCase();
	if (!from) return null;

	const subject =
		(parsed.subject || headers?.get('subject') || '').trim().slice(0, 200) || 'New email';
	const messageId = (parsed.messageId || headers?.get('message-id') || '').trim() || undefined;
	const inReplyTo = (parsed.inReplyTo || headers?.get('in-reply-to') || '').trim() || undefined;
	const references = parseReferenceList(parsed.references || headers?.get('references'));

	const text =
		(parsed.text && parsed.text.trim()) ||
		(parsed.html ? htmlToText(parsed.html) : '') ||
		'Email received.';

	return {
		from,
		name: parsed.from?.name?.trim() || undefined,
		to: (message.to || '').trim(),
		subject,
		messageId,
		inReplyTo,
		references,
		text: text.slice(0, 10_000),
		html: parsed.html || undefined
	};
}

// #endregion

// #region alias + threading

export function buildReplyAlias(baseAddress: string, ticketId: number): string {
	const [local, domain] = String(baseAddress).split('@');
	const cleanLocal = (local ?? 'support').split('+')[0];
	return `${cleanLocal}+t${ticketId}@${domain ?? 'localhost'}`;
}

export function parseReplyAlias(address: string): number | null {
	const match = String(address ?? '').match(/\+t(\d+)@/);
	return match ? Number(match[1]) : null;
}

async function ticketExists(ticketId: number): Promise<boolean> {
	const row = await first<DBTicket>(ticketId.toString(), `SELECT id FROM tickets WHERE id = ?`, [
		ticketId
	]);
	return row != null;
}

async function lookupMessageId(messageId: string): Promise<number | null> {
	const hash = await sha256Hex(normalizeMessageId(messageId));
	const ticketId = await kv.get<string>(msgidKey(hash));
	return ticketId ? Number(ticketId) : null;
}

export async function indexMessageId(messageId: string, ticketId: number): Promise<void> {
	const hash = await sha256Hex(normalizeMessageId(messageId));
	await kv.set(msgidKey(hash), String(ticketId), { ttl: MSGID_INDEX_TTL });
}

// resolve an inbound email to an existing ticket: alias is primary, then header chain
export async function resolveTicketForInbound(parsed: ParsedInboundEmail): Promise<number | null> {
	const aliasTicket = parseReplyAlias(parsed.to);
	if (aliasTicket && (await ticketExists(aliasTicket))) return aliasTicket;

	if (parsed.inReplyTo) {
		const byReply = await lookupMessageId(parsed.inReplyTo);
		if (byReply && (await ticketExists(byReply))) return byReply;
	}

	for (const reference of [...parsed.references].reverse()) {
		const byRef = await lookupMessageId(reference);
		if (byRef && (await ticketExists(byRef))) return byRef;
	}

	return null;
}

async function getThread(ticketId: number): Promise<EmailThread | null> {
	return await kv.get<EmailThread>(threadKey(ticketId), 'json');
}

async function setThread(ticketId: number, thread: EmailThread): Promise<void> {
	await kv.set(threadKey(ticketId), JSON.stringify(thread));
}

export async function initEmailThread(
	ticketId: number,
	subject: string,
	customerEmail: string
): Promise<void> {
	await setThread(ticketId, { subject, customer_email: customerEmail, references: [] });
}

export async function recordInboundOnThread(
	ticketId: number,
	parsed: ParsedInboundEmail
): Promise<void> {
	const thread = (await getThread(ticketId)) ?? {
		subject: parsed.subject,
		customer_email: parsed.from,
		references: []
	};

	if (parsed.messageId) {
		thread.last_message_id = parsed.messageId;
		thread.references = capReferences([...thread.references, parsed.messageId]);
	}

	await setThread(ticketId, thread);
}

function capReferences(references: string[]): string[] {
	const unique = Array.from(new Set(references.filter(Boolean)));
	return unique.slice(-50);
}

// #endregion

// #region mime + sending

function buildMime(options: {
	from: string;
	fromName?: string;
	to: string;
	subject: string;
	text: string;
	html?: string;
	messageId?: string;
	inReplyTo?: string;
	references?: string[];
}): string {
	const message = createMimeMessage();
	if (options.messageId) message.setHeader('Message-ID', options.messageId);
	if (options.inReplyTo) message.setHeader('In-Reply-To', options.inReplyTo);
	if (options.references && options.references.length > 0) {
		message.setHeader('References', options.references.join(' '));
	}
	message.setSender(
		options.fromName ? { name: options.fromName, addr: options.from } : options.from
	);
	message.setRecipient(options.to);
	message.setSubject(options.subject);
	message.addMessage({ contentType: 'text/plain', data: options.text });
	if (options.html) message.addMessage({ contentType: 'text/html', data: options.html });
	return message.asRaw();
}

function syntheticMessageId(ticketId: number, domain: string): string {
	return `<t${ticketId}.${Date.now()}.${crypto.randomUUID()}@${domain}>`;
}

function replySubject(subject: string): string {
	return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

const NOT_CONFIGURED_TEXT =
	'This service is not configured to receive emails. Please create a ticket on our website so our team can help you.';

// the single synchronous reply() allowed per inbound event: acknowledges the new ticket + ui link
export async function sendAutoAck(
	message: any,
	parsed: ParsedInboundEmail,
	ticketId: number,
	ticketTitle: string,
	env: any
): Promise<void> {
	if (typeof message.reply !== 'function') return;

	const link = `${await siteUrl(env)}/tickets/${ticketId}`;
	const text = `Thanks for reaching out — we've opened ticket #${ticketId}. Our team will reply to this thread shortly; you can also follow it here: ${link}`;

	// from = the per-ticket alias on the received domain (keeps reply() domain-aligned + routes replies back)
	const from = buildReplyAlias(message.to, ticketId);
	const raw = buildMime({
		from,
		fromName: 'Support',
		to: message.from,
		subject: replySubject(parsed.subject || ticketTitle),
		text,
		messageId: syntheticMessageId(ticketId, domainOf(message.to)),
		inReplyTo: parsed.messageId,
		references: parsed.messageId ? [parsed.messageId] : []
	});

	// lazy-import the workerd-only module so a node build (e2e preview) can load this file
	const { EmailMessage } = await import('cloudflare:email');
	await message.reply(new EmailMessage(from, message.from, raw));
}

export async function replyNotConfigured(message: any): Promise<void> {
	if (typeof message.reply !== 'function' || !message.to || !message.from) return;

	const raw = buildMime({
		from: message.to,
		fromName: 'Support',
		to: message.from,
		subject: 'Re: your message',
		text: NOT_CONFIGURED_TEXT
	});
	const { EmailMessage } = await import('cloudflare:email');
	await message.reply(new EmailMessage(message.to, message.from, raw));
}

type OutboundAttachment = { file_name: string; mimetype: string; data: string };

function base64ToBytes(data: string): Uint8Array {
	// tolerate a data: uri prefix; otherwise treat as raw base64
	const b64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function toEdgeportAttachments(items?: OutboundAttachment[]) {
	if (!items || items.length === 0) return undefined;
	return items.map((item) => ({
		filename: item.file_name,
		content: base64ToBytes(item.data),
		contentType: item.mimetype
	}));
}

// resolve the display-name for the outbound From given the chosen sender identity
function senderFromName(identity: SenderIdentity | undefined, agentName?: string): string {
	if (identity === 'self' && agentName) return agentName;
	return 'Support';
}

// deliver an agent's reply (with any attachments) to the customer via the resolved transport
export async function sendTicketEmailReply(
	ticketId: number,
	body: string,
	env: any,
	attachments?: OutboundAttachment[],
	options?: { identity?: SenderIdentity; agentName?: string }
): Promise<boolean> {
	if (!(await isEmailConfigured(env))) return false;

	const thread = await getThread(ticketId);
	if (!thread) return false;

	const ticket = await first<DBTicket>(ticketId.toString(), `SELECT * FROM tickets WHERE id = ?`, [
		ticketId
	]);
	if (!ticket || ticket.private === 1) return false;

	const transport = await getEmailConfig(env);
	if (!transport) return false;

	// alias is derived from the base support address so customer replies route back to the ticket
	const base = (await supportAddress(env)) || transport.from.replace(/^.*<|>.*$/g, '');
	const alias = buildReplyAlias(base, ticketId);
	const subject = replySubject(thread.subject || ticket.title);

	const headers: Record<string, string> = { 'Reply-To': alias };
	if (thread.last_message_id) {
		headers['In-Reply-To'] = thread.last_message_id;
		headers['References'] = capReferences([...thread.references, thread.last_message_id]).join(' ');
	} else if (thread.references.length > 0) {
		headers['References'] = thread.references.join(' ');
	}

	// override the transport display-name when replying as a named agent
	const fromName = senderFromName(options?.identity, options?.agentName);
	const fromAddress = transport.from.match(/<([^>]+)>/)?.[1] ?? transport.from;
	const from = `${fromName} <${fromAddress}>`;

	const { send } = await import('edgeport/smtp');
	await send({
		hostname: transport.hostname,
		port: transport.port,
		tls: transport.tls,
		auth: transport.auth,
		from,
		to: thread.customer_email,
		subject,
		text: body,
		headers,
		attachments: toEdgeportAttachments(attachments)
	});

	return true;
}

// #endregion

// #region agent email bridge

async function agentEmailHash(env: any, email: string): Promise<string> {
	return hmacSha256(env.HMAC_SECRET, email.trim().toLowerCase());
}

// link/unlink a work mailbox to a user so their email-client replies attribute to the account
export async function linkAgentEmail(env: any, email: string, userId: string): Promise<void> {
	await kv.set(agentEmailKey(await agentEmailHash(env, email)), userId);
}

export async function unlinkAgentEmail(env: any, email: string): Promise<void> {
	await kv.del(agentEmailKey(await agentEmailHash(env, email)));
}

export async function resolveAgentByEmail(env: any, email: string): Promise<string | null> {
	const byLink = await kv.get<string>(agentEmailKey(await agentEmailHash(env, email)));
	if (byLink) return byLink;
	// fall back to the account login email index
	const user = await getUserByEmail(email, env).catch(() => null);
	return user ? user.id : null;
}

// append an agent's email-client reply as a user message and mirror it to the customer
export async function appendAgentEmailReply(
	ticketId: number,
	agentId: string,
	parsed: ParsedInboundEmail,
	env: any
): Promise<void> {
	const agent = await getUserById(agentId, env).catch(() => null);
	await addTicketMessage(
		ticketId,
		{
			message: parsed.text,
			sender: agent
				? {
						kind: 'user',
						id: agent.id,
						username: agent.username,
						email: agent.email,
						name: agent.name,
						avatar_url: agent.avatar_url
					}
				: { kind: 'user', id: agentId, username: 'team', name: 'Team' }
		},
		env
	);

	// mirror the agent's reply back to the customer as a named reply
	await sendTicketEmailReply(ticketId, parsed.text, env, undefined, {
		identity: 'self',
		agentName: agent?.name || agent?.username
	}).catch((error: unknown) => console.warn('Failed to mirror agent email reply', error));
}

// forward an inbound customer message to the ticket's assignees (or a team inbox fallback)
export async function forwardToAgents(
	ticketId: number,
	parsed: ParsedInboundEmail,
	env: any
): Promise<void> {
	if (!(await isEmailConfigured(env))) return;

	const email = await getEmailSettings();
	if (email.forward_to_agents === false) return;

	const ticket = await getTicketById(ticketId, env, null).catch(() => null);
	if (!ticket) return;

	// gather assignee mailboxes; only those allowed to view the ticket
	const recipients: string[] = [];
	for (const assignee of ticket.assignees ?? []) {
		if (!canViewPrivateTicket(assignee, ticket)) continue;
		if (assignee.email) recipients.push(assignee.email);
	}

	// team-inbox fallback when unassigned; never leak a private ticket to a broad inbox
	if (recipients.length === 0 && !ticket.private) {
		const team = email.team_inbox || (await supportAddress(env));
		if (team) recipients.push(team);
	}
	if (recipients.length === 0) return;

	const transport = await getEmailConfig(env);
	if (!transport) return;

	const base = (await supportAddress(env)) || transport.from.replace(/^.*<|>.*$/g, '');
	const alias = buildReplyAlias(base, ticketId);
	const fromAddress = transport.from.match(/<([^>]+)>/)?.[1] ?? transport.from;
	const subject = replySubject(parsed.subject);
	const text = `New customer message on ticket #${ticketId} from ${parsed.name || parsed.from}:\n\n${parsed.text}\n\nReply to this email to respond to the customer.`;

	const { send } = await import('edgeport/smtp');
	await send({
		hostname: transport.hostname,
		port: transport.port,
		tls: transport.tls,
		auth: transport.auth,
		from: `Support <${fromAddress}>`,
		to: recipients,
		subject,
		text,
		headers: { 'Reply-To': alias }
	});
}

// #endregion
