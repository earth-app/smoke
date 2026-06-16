import { allAllShardsGlobal, first } from '@earth-app/collegedb';
import { EmailMessage } from 'cloudflare:email';
import { DBTicket } from 'hub:db:schema';
import { createMimeMessage } from 'mimetext';
import PostalMime from 'postal-mime';

// #region types + constants

const VERIFIED_ADDRESS_LIMIT = 200;

// env vars the email engine needs before it will accept/answer inbound mail
const REQUIRED_ENV = [
	'MASTER_KEY',
	'HMAC_SECRET',
	'CF_API_TOKEN',
	'CF_ACCOUNT_ID',
	'SUPPORT_EMAIL'
];

// ticket statuses that free a customer's verified-address slot
const CLOSED_STATUSES = ['closed', 'wont_fix'];

const MSGID_INDEX_TTL = 60 * 60 * 24 * 90;
const ADDRESS_COUNT_CACHE_KEY = 'smoke:email_addr_count';
const REAP_THROTTLE_KEY = 'smoke:email_reap_at';
const REAP_INTERVAL_SECONDS = 60 * 60;
const REAP_UNVERIFIED_MAX_AGE_MS = 60 * 60 * 72 * 1000;

type EmailThread = {
	subject: string;
	customer_email: string;
	last_message_id?: string;
	references: string[];
};

type AddressRecord = {
	id: string;
	verified: boolean;
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

export function isEmailConfigured(env: any): boolean {
	return REQUIRED_ENV.every((key) => typeof env?.[key] === 'string' && env[key].length > 0);
}

function siteUrl(env: any): string {
	const url = env?.NUXT_PUBLIC_SITE_URL;
	return typeof url === 'string' && url.length > 0
		? url.replace(/\/$/, '')
		: 'https://smoke.pages.dev';
}

function supportDomain(env: any): string {
	const support = String(env?.SUPPORT_EMAIL ?? '');
	return support.split('@')[1] ?? 'localhost';
}

// #endregion

// #region kv keys + hashing

const msgidKey = (hash: string) => `smoke:email_msgid:${hash}`;
const threadKey = (ticketId: number) => `smoke:email_thread:${ticketId}`;
const disabledKey = (ticketId: number) => `smoke:email_disabled:${ticketId}`;
const addressKey = (emailHash: string) => `smoke:email_addr:${emailHash}`;

function normalizeMessageId(messageId: string): string {
	return messageId.trim().replace(/^<|>$/g, '').toLowerCase();
}

async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input));
	return bytesToHex(new Uint8Array(digest));
}

async function emailHash(email: string, env: any): Promise<string> {
	// reuse the hmac-email-lookup convention so no plaintext email lands in a kv key
	return await hmacSha256(env.HMAC_SECRET, email.trim().toLowerCase());
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

// #region disabled state

async function isThreadDisabled(ticketId: number): Promise<boolean> {
	return (await kv.get<string>(disabledKey(ticketId))) === '1';
}

async function disableThread(ticketId: number): Promise<void> {
	await kv.set(disabledKey(ticketId), '1');
}

export async function forgetTicketEmailState(ticketId: number): Promise<void> {
	await kv.del(threadKey(ticketId));
	await kv.del(disabledKey(ticketId));
}

// #endregion

// #region cloudflare api

async function cfAddressesFetch(env: any, path: string, init?: RequestInit): Promise<any> {
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/routing/addresses${path}`,
		{
			...init,
			headers: {
				Authorization: `Bearer ${env.CF_API_TOKEN}`,
				'Content-Type': 'application/json',
				...(init?.headers ?? {})
			}
		}
	);

	return await response.json().catch(() => null);
}

async function countVerifiedAddresses(env: any): Promise<number> {
	return await cache(
		ADDRESS_COUNT_CACHE_KEY,
		async () => {
			const result = await cfAddressesFetch(env, '?per_page=5');
			return Number(result?.result_info?.total_count ?? 0);
		},
		60
	);
}

async function getAddressRecord(email: string, env: any): Promise<AddressRecord | null> {
	const hash = await emailHash(email, env);
	return await kv.get<AddressRecord>(addressKey(hash), 'json');
}

async function setAddressRecord(email: string, env: any, record: AddressRecord): Promise<void> {
	const hash = await emailHash(email, env);
	await kv.set(addressKey(hash), JSON.stringify(record));
}

async function deleteAddressRecord(email: string, env: any): Promise<void> {
	const hash = await emailHash(email, env);
	await kv.del(addressKey(hash));
}

// create a destination address (cloudflare sends the verification email); returns
// null when the account is at capacity or the api rejects the request
async function provisionAddress(email: string, env: any): Promise<AddressRecord | null> {
	const existing = await getAddressRecord(email, env);
	if (existing) return existing;

	const count = await countVerifiedAddresses(env);
	if (count >= VERIFIED_ADDRESS_LIMIT) return null;

	const result = await cfAddressesFetch(env, '', {
		method: 'POST',
		body: JSON.stringify({ email })
	});
	if (!result?.success || !result?.result?.id) return null;

	const record: AddressRecord = { id: result.result.id, verified: result.result.verified != null };
	await setAddressRecord(email, env, record);
	await kv.del(ADDRESS_COUNT_CACHE_KEY);
	return record;
}

export async function isEmailVerified(email: string, env: any): Promise<boolean> {
	const record = await getAddressRecord(email, env);
	if (!record) return false;
	if (record.verified) return true;

	const result = await cfAddressesFetch(env, `/${record.id}`);
	const verified = result?.result?.verified != null;
	if (verified) {
		await setAddressRecord(email, env, { ...record, verified: true });
	}
	return verified;
}

async function releaseAddress(email: string, env: any): Promise<void> {
	const record = await getAddressRecord(email, env);
	if (!record) return;

	await cfAddressesFetch(env, `/${record.id}`, { method: 'DELETE' });
	await deleteAddressRecord(email, env);
	await kv.del(ADDRESS_COUNT_CACHE_KEY);
}

// free a customer's address only when none of their tickets are still open
export async function releaseEmailAddressIfNoOpenTickets(
	customerId: number,
	env: any
): Promise<void> {
	if (!isEmailConfigured(env)) return;

	const customer = await getCustomerById(customerId, env);
	if (!customer) return;

	const rows = await allAllShardsGlobal<Pick<DBTicket, 'id' | 'status'>>(
		`SELECT id, status FROM tickets WHERE customer_id = ?`,
		[customerId]
	);
	const hasOpen = rows.results.some((row) => !CLOSED_STATUSES.includes(String(row.status)));
	if (hasOpen) return;

	await releaseAddress(customer.email, env);
}

// best-effort cleanup of addresses that were created but never verified
export async function reapStaleUnverified(env: any): Promise<void> {
	if (!isEmailConfigured(env)) return;

	const last = Number((await kv.get<string>(REAP_THROTTLE_KEY)) ?? 0);
	const now = Date.now();
	if (now - last < REAP_INTERVAL_SECONDS * 1000) return;
	await kv.set(REAP_THROTTLE_KEY, String(now), { ttl: REAP_INTERVAL_SECONDS });

	const result = await cfAddressesFetch(env, '?per_page=50&direction=asc');
	const addresses: any[] = Array.isArray(result?.result) ? result.result : [];
	for (const address of addresses) {
		if (address?.verified != null) continue;
		const created = address?.created ? Date.parse(address.created) : now;
		if (now - created < REAP_UNVERIFIED_MAX_AGE_MS) continue;
		if (address?.id) await cfAddressesFetch(env, `/${address.id}`, { method: 'DELETE' });
	}
	await kv.del(ADDRESS_COUNT_CACHE_KEY);
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

function syntheticMessageId(ticketId: number, env: any): string {
	return `<t${ticketId}.${Date.now()}.${crypto.randomUUID()}@${supportDomain(env)}>`;
}

function replySubject(subject: string): string {
	return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

const NOT_CONFIGURED_TEXT =
	'This service is not configured to receive emails. Please create a ticket on our website so our team can help you.';

export async function sendAutoAck(
	message: any,
	parsed: ParsedInboundEmail,
	ticketId: number,
	ticketTitle: string,
	state: 'active' | 'disabled',
	env: any
): Promise<void> {
	if (typeof message.reply !== 'function') return;

	const link = `${siteUrl(env)}/tickets/${ticketId}`;
	const text =
		state === 'disabled'
			? `Thanks for reaching out — we've opened ticket #${ticketId}. We're experiencing a high volume right now, so this email thread will not receive updates. Please follow your ticket here: ${link}`
			: `Thanks for reaching out — we've opened ticket #${ticketId}. You'll shortly receive a separate verification email from Cloudflare; confirm it to keep getting replies here. You can also follow your ticket at ${link}`;

	const from = buildReplyAlias(message.to, ticketId);
	const raw = buildMime({
		from,
		fromName: 'Support',
		to: message.from,
		subject: replySubject(parsed.subject || ticketTitle),
		text,
		messageId: syntheticMessageId(ticketId, env),
		inReplyTo: parsed.messageId,
		references: parsed.messageId ? [parsed.messageId] : []
	});

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
	await message.reply(new EmailMessage(message.to, message.from, raw));
}

// deliver an agent's reply to the customer over email, threaded into the conversation;
// no-op for tickets that aren't email-linked, disabled, private, or unverified
export async function sendTicketEmailReply(
	ticketId: number,
	body: string,
	env: any
): Promise<boolean> {
	if (!isEmailConfigured(env)) return false;

	const thread = await getThread(ticketId);
	if (!thread) return false;
	if (await isThreadDisabled(ticketId)) return false;

	const ticket = await first<DBTicket>(ticketId.toString(), `SELECT * FROM tickets WHERE id = ?`, [
		ticketId
	]);
	if (!ticket || ticket.private === 1) return false;

	const email = thread.customer_email;
	if (!(await isEmailVerified(email, env))) return false;

	const from = buildReplyAlias(env.SUPPORT_EMAIL, ticketId);
	const synthetic = syntheticMessageId(ticketId, env);
	const references = capReferences([
		...thread.references,
		...(thread.last_message_id ? [thread.last_message_id] : []),
		synthetic
	]);

	const raw = buildMime({
		from,
		fromName: 'Support',
		to: email,
		subject: replySubject(thread.subject || ticket.title),
		text: body,
		messageId: synthetic,
		inReplyTo: thread.last_message_id,
		references
	});

	await env.EMAIL.send(new EmailMessage(from, email, raw));

	thread.references = references;
	thread.last_message_id = synthetic;
	await setThread(ticketId, thread);
	await indexMessageId(synthetic, ticketId);
	return true;
}

// provision (or look up) the customer's verified address for a new conversation,
// degrading the whole thread to disabled when the account is at capacity
export async function ensureThreadVerification(
	email: string,
	ticketId: number,
	env: any
): Promise<'active' | 'disabled'> {
	const record = await provisionAddress(email, env);
	if (!record) {
		await disableThread(ticketId);
		return 'disabled';
	}
	return (await isThreadDisabled(ticketId)) ? 'disabled' : 'active';
}

// #endregion
