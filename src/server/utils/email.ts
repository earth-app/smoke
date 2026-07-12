import type { DBTicket } from 'hub:db:schema';
import { createMimeMessage } from 'mimetext';
import PostalMime from 'postal-mime';

// #region types + constants

// keys that gate the crypto + threading layer; transport is resolved separately via getEmailConfig
const REQUIRED_ENV = ['MASTER_KEY', 'HMAC_SECRET'];

const MSGID_INDEX_TTL = 60 * 60 * 24 * 90;

// kv index mapping a linked agent mailbox hash -> user id (work mailbox != login email)
const agentEmailKey = (hash: string) => `smoke:agent_email:${hash}`;

export type SenderIdentity = 'self' | 'team';

// honest email-channel readiness the ui can trust. configured means a send should actually
// work; needsOnboarding flags a cloudflare token+domain that still needs dkim/spf verified
export type EmailConfigStatus = {
	configured: boolean;
	transport: 'cloudflare' | 'smtp' | null;
	needsOnboarding: boolean;
	reason?: string;
};

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
	// all To addresses (normalized lowercase); `to` above stays the raw envelope for alias resolution
	recipients?: string[];
	// all Cc addresses (normalized lowercase)
	cc?: string[];
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

const CF_TOKEN_KEY = 'smoke:setting:cloudflare_token';

function hasEnvSmtp(env: any): boolean {
	return typeof env?.SMTP_HOST === 'string' && env.SMTP_HOST.length > 0;
}

// resolve a deliberate cloudflare token: the sealed setting first (linked account),
// then an explicitly-set env token; a missing token means the channel isn't set up
async function resolveCfToken(
	env: any
): Promise<{ token: string; source: 'linked' | 'env' | null }> {
	const sealed = await kv.get<any>(CF_TOKEN_KEY, 'json').catch(() => null);
	if (sealed && env?.MASTER_KEY) {
		const token = await openSecret(sealed, env.MASTER_KEY).catch(() => '');
		if (token) return { token, source: 'linked' };
	}
	const envToken = cloudflareApiToken(env);
	if (envToken) return { token: envToken, source: 'env' };
	return { token: '', source: null };
}

// the status the settings/setup ui renders; unlike isEmailConfigured it refuses to report
// "configured" for a cloudflare domain whose email sending isn't onboarded (dkim/spf verified)
export async function emailConfigStatus(env: any): Promise<EmailConfigStatus> {
	const hasKeys = REQUIRED_ENV.every(
		(key) => typeof env?.[key] === 'string' && env[key].length > 0
	);
	if (!hasKeys) {
		return {
			configured: false,
			transport: null,
			needsOnboarding: false,
			reason: 'Encryption keys (MASTER_KEY / HMAC_SECRET) are not set.'
		};
	}

	const email = await getEmailSettings();

	// custom smtp: an env override wins, otherwise an explicit smtp transport
	if (hasEnvSmtp(env) || email.transport === 'smtp') {
		if (hasEnvSmtp(env) || email.smtp?.host) {
			return { configured: true, transport: 'smtp', needsOnboarding: false };
		}
		return {
			configured: false,
			transport: 'smtp',
			needsOnboarding: false,
			reason: 'Add your SMTP host, port, and credentials to finish the custom transport.'
		};
	}

	// cloudflare email service (default transport)
	const support = await supportAddress(env);
	const { token, source } = await resolveCfToken(env);
	if (!token || !source) {
		return {
			configured: false,
			transport: 'cloudflare',
			needsOnboarding: false,
			reason: 'Link a Cloudflare account (or set CF_API_TOKEN) to send email.'
		};
	}
	if (!support) {
		return {
			configured: false,
			transport: 'cloudflare',
			needsOnboarding: false,
			reason: 'Set a support email address so Cloudflare knows which domain to send from.'
		};
	}

	// a token + support resolve a transport, but sending only works once the domain is
	// onboarded to email sending; probe cloudflare (mock-armed) to verify before claiming active
	setMockCf(isMockCf(env));
	const cf = await getCloudflareSettings();
	const domain = domainOf(support);
	const verified = await isEmailSendingVerified(token, cf.zone_id ?? '', domain).catch(() => false);
	if (!verified) {
		return {
			configured: false,
			transport: 'cloudflare',
			needsOnboarding: true,
			reason: `Verify ${domain} for Cloudflare Email Sending by adding the DKIM/SPF DNS records.`
		};
	}

	return { configured: true, transport: 'cloudflare', needsOnboarding: false };
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
		recipients: addressList(parsed.to),
		cc: addressList(parsed.cc),
		subject,
		messageId,
		inReplyTo,
		references,
		text: text.slice(0, 10_000),
		html: parsed.html || undefined
	};
}

// postal-mime parses address headers as { name, address }[]; flatten to normalized addresses
function addressList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => (entry && typeof entry === 'object' ? (entry as any).address : entry))
		.filter((addr: unknown): addr is string => typeof addr === 'string' && addr.length > 0)
		.map((addr) => addr.trim().toLowerCase());
}

// add every cc'd / additional To address on an inbound message as a ticket participant.
// skips the base support address, reply aliases, and the sender; best-effort (never throws)
export async function captureInboundParticipants(
	ticketId: number,
	parsed: ParsedInboundEmail,
	env: any
): Promise<void> {
	try {
		const support = (await supportAddress(env)).trim().toLowerCase();
		const from = (parsed.from ?? '').trim().toLowerCase();
		const candidates = [...(parsed.recipients ?? []), ...(parsed.cc ?? [])];
		for (const raw of candidates) {
			const addr = (raw ?? '').trim().toLowerCase();
			if (!addr) continue;
			if (support && addr === support) continue;
			if (parseReplyAlias(addr) !== null) continue;
			if (from && addr === from) continue;
			await addTicketParticipant(ticketId, addr, env).catch(() => {});
		}
	} catch {
		// capturing participants must never break inbound processing
	}
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
	const row = await firstRow<DBTicket>(ticketId.toString(), `SELECT id FROM tickets WHERE id = ?`, [
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

	// tokenized status link so an email-opened ticket is viewable + replyable in the ui
	const site = await siteUrl(env);
	const statusToken = await hmacSha256(env.HMAC_SECRET, `status:${ticketId}`);
	const link = `${site}/status/${statusToken}?id=${ticketId}`;
	const portal = `${site}/portal/login`;
	const text =
		`Thanks for reaching out; we've opened ticket #${ticketId}. Our team will reply to this thread shortly.\n\n` +
		`You can reply straight from this email, or follow your request here: ${link}\n\n` +
		`Want all your requests in one place? Verify your email at ${portal} to manage them from the customer portal.`;

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

	await recordAudit(env, {
		action: 'auth.magic_link_issued',
		targetType: 'ticket',
		targetId: ticketId,
		ticketId,
		priority: 'low',
		summary: `Issued a status access link for ticket #${ticketId}`,
		context: { channel: 'auto_ack' }
	});
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

// stamps our own outbound so a polled mailbox that receives sent copies never re-ingests it
export const OUTBOUND_MARKER_HEADER = 'X-Smoke-Outbound';

// deliver an agent's reply (with any attachments) to the customer via the resolved transport
export async function sendTicketEmailReply(
	ticketId: number,
	body: string,
	env: any,
	attachments?: OutboundAttachment[],
	options?: { identity?: SenderIdentity; agentName?: string; cc?: string[]; senderEmail?: string }
): Promise<boolean> {
	if (!(await isEmailConfigured(env))) return false;

	const thread = await getThread(ticketId);
	if (!thread) return false;

	const ticket = await firstRow<DBTicket>(
		ticketId.toString(),
		`SELECT * FROM tickets WHERE id = ?`,
		[ticketId]
	);
	// mirror on any email thread: the customer opened it by email, so a deliberate reply always
	// reaches them; ticket privacy restricts staff visibility, not the originating customer
	if (!ticket) return false;

	const transport = await getEmailConfig(env);
	if (!transport) return false;

	// alias is derived from the base support address so customer replies route back to the ticket
	const base = (await supportAddress(env)) || transport.from.replace(/^.*<|>.*$/g, '');
	const alias = buildReplyAlias(base, ticketId);
	const subject = replySubject(thread.subject || ticket.title);

	const headers: Record<string, string> = { 'Reply-To': alias, [OUTBOUND_MARKER_HEADER]: '1' };
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

	// keep every participant copied on the thread, minus the primary customer + the sender
	const primary = (thread.customer_email ?? '').trim().toLowerCase();
	const senderEmail = (options?.senderEmail ?? '').trim().toLowerCase();
	const ccSet = new Set<string>();
	for (const entry of [...(await getTicketParticipants(ticketId)), ...(options?.cc ?? [])]) {
		const addr = (entry ?? '').trim().toLowerCase();
		if (!addr || addr === primary || (senderEmail && addr === senderEmail)) continue;
		ccSet.add(addr);
	}
	const cc = ccSet.size > 0 ? [...ccSet] : undefined;

	const { send } = await import('edgeport/smtp');
	await send({
		hostname: transport.hostname,
		port: transport.port,
		tls: transport.tls,
		auth: transport.auth,
		from,
		to: thread.customer_email,
		cc,
		subject,
		text: body,
		headers,
		attachments: toEdgeportAttachments(attachments)
	});

	return true;
}

// send a standalone email to a customer (e.g. a customer.created welcome from a flow); no thread
export async function sendCustomerEmail(
	to: string,
	subject: string,
	body: string,
	env: any
): Promise<boolean> {
	if (!to || !to.trim()) return false;
	const transport = await getEmailConfig(env);
	if (!transport) return false;

	const { send } = await import('edgeport/smtp');
	await send({
		hostname: transport.hostname,
		port: transport.port,
		tls: transport.tls,
		auth: transport.auth,
		from: transport.from,
		to: to.trim(),
		subject,
		text: body,
		headers: { [OUTBOUND_MARKER_HEADER]: '1' }
	});
	return true;
}

// email a newly-added participant their access invite: the status magic-link + portal login +
// a short summary + an optional agent note; the reply alias threads any reply back to the ticket
export async function sendTicketAccessInvite(
	ticketId: number,
	toEmail: string,
	subject: string,
	summary: string,
	env: any,
	note?: string
): Promise<boolean> {
	const to = (toEmail ?? '').trim();
	if (!to) return false;

	const transport = await getEmailConfig(env);
	if (!transport) return false;

	const site = await siteUrl(env);
	const statusToken = await hmacSha256(env.HMAC_SECRET, `status:${ticketId}`);
	const link = `${site}/status/${statusToken}?id=${ticketId}`;
	const portal = `${site}/portal/login`;

	const lines = [
		`You've been added to support request #${ticketId}: ${subject}`,
		'',
		summary,
		'',
		`View and reply to this request here: ${link}`,
		'',
		`Manage all your requests from the customer portal: ${portal}`
	];
	if (note && note.trim()) lines.push('', 'Note from our team:', note.trim());

	const base = (await supportAddress(env)) || transport.from.replace(/^.*<|>.*$/g, '');
	const alias = buildReplyAlias(base, ticketId);

	const { send } = await import('edgeport/smtp');
	await send({
		hostname: transport.hostname,
		port: transport.port,
		tls: transport.tls,
		auth: transport.auth,
		from: transport.from,
		to,
		subject: replySubject(subject),
		text: lines.join('\n'),
		headers: { 'Reply-To': alias, [OUTBOUND_MARKER_HEADER]: '1' }
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

	// an agent cc'ing a stakeholder from their mailbox grants them access to the ticket
	await captureInboundParticipants(ticketId, parsed, env);

	// mirror the agent's reply back to the customer as a named reply (auto-ccs participants)
	await sendTicketEmailReply(ticketId, parsed.text, env, undefined, {
		identity: 'self',
		agentName: agent?.name || agent?.username,
		senderEmail: agent?.email
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
		headers: { 'Reply-To': alias, [OUTBOUND_MARKER_HEADER]: '1' }
	});
}

// #endregion
