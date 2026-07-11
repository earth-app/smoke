import { allAllShardsGlobal } from '@earth-app/collegedb';
import type { H3Event } from 'h3';
import type { DBTicket } from 'hub:db:schema';
import { ensureCollegeDB } from 'hub:db:schema';
import { kv } from 'hub:kv';
import { TicketVisibility } from '~/shared/types/ticket';
import type { Customer } from '~/shared/types/user';

// customer session cookie; mirrors the staff session scheme but scoped to a verified customer.
// the hybrid model: a signed-in customer is an ADDITIONAL authorizer alongside the per-ticket
// hmac status token, so email magic-links keep working while the portal manages all requests
export const CUSTOMER_SESSION_COOKIE = 'customer_session';

const CUSTOMER_SESSION_TOKEN_BYTES = 48;
const CUSTOMER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const MAX_CUSTOMER_SESSIONS = 5;

const OTP_CODE_LENGTH = 6;
const OTP_TTL_SECONDS = 60 * 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_SECONDS = 60;

// #region kv keys

const sessionHashKey = (customerId: number, hash: string) =>
	`smoke:customer_session_hash:${customerId}:${hash}`;
const sessionUserKey = (hash: string) => `smoke:customer_session_user:${hash}`;
const otpKey = (emailHash: string) => `smoke:customer_otp:${emailHash}`;
const otpCooldownKey = (emailHash: string) => `smoke:customer_otp_cooldown:${emailHash}`;

type OtpRecord = {
	code: string;
	expires: number;
	attempts: number;
};

// #endregion

// #region hashing + cookie

async function hashCustomerToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(token));
	return bytesToHex(new Uint8Array(digest));
}

async function customerEmailHash(email: string, env: any): Promise<string> {
	return await hmacSha256(env.HMAC_SECRET, email.trim().toLowerCase());
}

// e2e runs over http on 127.0.0.1 where a secure/samesite=none cookie is dropped; relax it there.
// env is authoritative (unit harness); the built-in runtime config is the node-preview fallback
function isE2E(env: any): boolean {
	if (String(env?.NUXT_PUBLIC_E2E) === '1' || env?.NUXT_PUBLIC_E2E === true) return true;
	try {
		return useRuntimeConfig().public.e2e === true;
	} catch {
		return false;
	}
}

function customerCookieOptions(env: any) {
	const e2e = isE2E(env);
	return {
		path: '/',
		httpOnly: true,
		secure: !e2e,
		sameSite: (e2e ? 'lax' : 'none') as 'lax' | 'none',
		maxAge: CUSTOMER_SESSION_TTL_SECONDS
	};
}

// #endregion

// #region session tokens

export async function createCustomerSession(customerId: number): Promise<string> {
	const token = bytesToBase64Url(randomBytes(CUSTOMER_SESSION_TOKEN_BYTES));
	const tokenHash = await hashCustomerToken(token);

	// keep only a small number of active sessions per customer
	const prefix = `smoke:customer_session_hash:${customerId}:`;
	const keys = await kv.keys(prefix);
	if (keys.length >= MAX_CUSTOMER_SESSIONS) {
		const keysToDelete = keys.slice(0, keys.length - (MAX_CUSTOMER_SESSIONS - 1));
		await Promise.all(
			keysToDelete.map(async (key) => {
				const oldHash = key.split(':')[3];
				const operations: Promise<void>[] = [kv.del(key)];
				if (oldHash) operations.push(kv.del(sessionUserKey(oldHash)));
				await Promise.all(operations);
			})
		);
	}

	await Promise.all([
		kv.set(sessionHashKey(customerId, tokenHash), '1', { ttl: CUSTOMER_SESSION_TTL_SECONDS }),
		kv.set(sessionUserKey(tokenHash), String(customerId), { ttl: CUSTOMER_SESSION_TTL_SECONDS })
	]);

	return token;
}

// mint a customer session and set its cookie; shared by otp verify + magic-link consume
export async function startCustomerSession(
	event: H3Event,
	customerId: number,
	env: any
): Promise<string> {
	const token = await createCustomerSession(customerId);
	setCookie(event, CUSTOMER_SESSION_COOKIE, token, customerCookieOptions(env));
	return token;
}

// #endregion

// #region otp

function generateOtpCode(): string {
	const bytes = randomBytes(4);
	const num = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
	return String(num % 10 ** OTP_CODE_LENGTH).padStart(OTP_CODE_LENGTH, '0');
}

// generate + email a one-time code; silently succeeds for an unknown email so membership never leaks
export async function requestCustomerOtp(email: string, env: any): Promise<void> {
	ensureCollegeDB(env);
	const normalized = email.trim().toLowerCase();
	if (!normalized) return;

	const emailHash = await customerEmailHash(normalized, env);

	// short cooldown so one email can't be spammed with codes; still return quietly
	const cooling = await kv.get<string>(otpCooldownKey(emailHash));
	if (cooling) return;

	// only mint a code for a real customer; do nothing (but look identical) otherwise
	const customer = await getCustomerByEmail(normalized, env);
	if (!customer) return;

	const code = generateOtpCode();
	const record: OtpRecord = { code, expires: Date.now() + OTP_TTL_SECONDS * 1000, attempts: 0 };
	await kv.set(otpKey(emailHash), JSON.stringify(record), { ttl: OTP_TTL_SECONDS });
	await kv.set(otpCooldownKey(emailHash), '1', { ttl: OTP_COOLDOWN_SECONDS });

	const subject = 'Your Verification Code';
	const body =
		`Your verification code is ${code}\n\n` +
		`Enter it to sign in and manage your support requests. ` +
		`The code expires in ${OTP_TTL_SECONDS / 60} minutes.\n\n` +
		`If you did not request this, you can ignore this email.`;
	await sendCustomerEmail(normalized, subject, body, env);
}

// validate a code, mint a session (set the cookie), and return the verified customer
export async function verifyCustomerOtp(
	email: string,
	code: string,
	event: H3Event,
	env: any
): Promise<Customer> {
	ensureCollegeDB(env);
	const normalized = email.trim().toLowerCase();
	const emailHash = await customerEmailHash(normalized, env);

	// 'json' hints the kv backend to parse; unstorage's overloads reject the positional for object
	// types, so cast the arg (runtime-significant) + the result
	const raw = (await kv.get(otpKey(emailHash), 'json' as never)) as OtpRecord | null;
	if (!raw) {
		throw createError({ statusCode: 400, message: 'Invalid or Expired Code' });
	}

	if (Date.now() > raw.expires) {
		await kv.del(otpKey(emailHash));
		throw createError({ statusCode: 400, message: 'Invalid or Expired Code' });
	}

	if (raw.attempts >= OTP_MAX_ATTEMPTS) {
		await kv.del(otpKey(emailHash));
		throw createError({ statusCode: 429, message: 'Too Many Attempts, Request a New Code' });
	}

	if (code.trim() !== raw.code) {
		const remaining = Math.max(1, Math.ceil((raw.expires - Date.now()) / 1000));
		await kv.set(otpKey(emailHash), JSON.stringify({ ...raw, attempts: raw.attempts + 1 }), {
			ttl: remaining
		});
		throw createError({ statusCode: 400, message: 'Invalid or Expired Code' });
	}

	const customer = await getCustomerByEmail(normalized, env);
	if (!customer) {
		await kv.del(otpKey(emailHash));
		throw createError({ statusCode: 400, message: 'Invalid or Expired Code' });
	}

	await Promise.all([kv.del(otpKey(emailHash)), kv.del(otpCooldownKey(emailHash))]);

	await startCustomerSession(event, customer.id, env);

	return customer;
}

// #endregion

// #region session resolution

// resolve the currently signed-in customer from the session cookie; null when not signed in
export async function getOptionalCustomer(event: H3Event): Promise<Customer | null> {
	const token = getCookie(event, CUSTOMER_SESSION_COOKIE);
	if (!token) return null;

	const tokenHash = await hashCustomerToken(token);
	const customerId = await kv.get<string>(sessionUserKey(tokenHash));
	if (!customerId) return null;

	// some kv backends coerce the stored '1' to number 1 on read
	const exists = await kv.get<string>(sessionHashKey(Number(customerId), tokenHash));
	if (String(exists) !== '1') return null;

	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);
	return await getCustomerById(Number(customerId), env);
}

export async function logoutCustomer(event: H3Event): Promise<void> {
	const env = event.context.cloudflare.env;
	const token = getCookie(event, CUSTOMER_SESSION_COOKIE);
	if (token) {
		const tokenHash = await hashCustomerToken(token);
		const customerId = await kv.get<string>(sessionUserKey(tokenHash));
		await kv.del(sessionUserKey(tokenHash));
		if (customerId) await kv.del(sessionHashKey(Number(customerId), tokenHash));
	}

	setCookie(event, CUSTOMER_SESSION_COOKIE, '', { ...customerCookieOptions(env), maxAge: 0 });
}

// #endregion

// #region customer tickets

export type CustomerTicketSummary = {
	id: number;
	title: string;
	status: string;
	priority: string;
	created_at: Date;
	updated_at: Date;
	locked: boolean;
	archived: boolean;
	// the zero-friction magic-link credential for /status/<token>?id=<id>
	token: string;
};

// list a customer's own requests with a per-ticket status token; staff-internal tickets are hidden
export async function listTicketsByCustomer(
	customerId: number,
	env: any
): Promise<CustomerTicketSummary[]> {
	ensureCollegeDB(env);
	if (!customerId || customerId <= 0) return [];

	const result = await allAllShardsGlobal<DBTicket>('SELECT * FROM tickets WHERE customer_id = ?', [
		customerId
	]);

	const summaries: CustomerTicketSummary[] = [];
	const seen = new Set<number>();

	const pushRow = async (row: DBTicket): Promise<void> => {
		if (seen.has(row.id)) return;
		const meta = await getTicketMeta(row.id);
		const visibility =
			(meta.visibility as TicketVisibility) ??
			(row.private === 1 ? TicketVisibility.Private : TicketVisibility.Public);
		if (visibility === TicketVisibility.Internal) return;

		seen.add(row.id);
		summaries.push({
			id: row.id,
			title: row.title,
			status: String(row.status),
			priority: String(row.priority),
			created_at: new Date(Number(row.created_at) * 1000),
			updated_at: new Date(Number(row.updated_at) * 1000),
			locked: meta.locked === true,
			archived: meta.archived === true,
			token: await hmacSha256(env.HMAC_SECRET, `status:${row.id}`)
		});
	};

	for (const row of result.results) await pushRow(row);

	// union in tickets this customer was cc'd on / forwarded (participant access); guard deleted rows
	for (const ticketId of await listParticipantTicketIds(customerId)) {
		if (seen.has(ticketId)) continue;
		const row = await firstRow<DBTicket>(
			ticketId.toString(),
			'SELECT * FROM tickets WHERE id = ?',
			[ticketId]
		);
		if (row) await pushRow(row);
	}

	summaries.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
	return summaries;
}

// #endregion
