import { ensureCollegeDB } from 'hub:db:schema';
import { kv } from 'hub:kv';

// ticket-like temporary tokens shared by agent onboarding + staff password reset.
// both are KV-only (no schema changes), mirroring the customer OTP module in customer-auth.ts

// #region constants

const INVITE_TOKEN_BYTES = 32;
const DEFAULT_INVITE_TTL_MINUTES = 30;
const MAX_INVITE_TTL_MINUTES = 60 * 24; // 24h ceiling
const DEFAULT_INVITE_MAX_USES = 1;
const MAX_INVITE_USES = 100;

const RESET_CODE_LENGTH = 8;
const RESET_TTL_SECONDS = 60 * 10;
const RESET_MAX_ATTEMPTS = 5;
const RESET_COOLDOWN_SECONDS = 60;

// #endregion

// #region kv keys + types

const inviteKey = (token: string) => `smoke:agent_invite:${token}`;
const resetKey = (emailHash: string) => `smoke:agent_pwreset:${emailHash}`;
const resetCooldownKey = (emailHash: string) => `smoke:agent_pwreset_cooldown:${emailHash}`;

export type AgentInvite = {
	// bound email locks the join to a single address; absent = open invite (email collected at join)
	email?: string;
	role: 'agent';
	createdBy: string;
	createdAt: number;
	expires: number; // epoch ms
	maxUses: number;
	uses: number;
};

export type AgentInviteStatus = 'valid' | 'expired' | 'exhausted' | 'not_found';

type ResetRecord = {
	code: string;
	expires: number;
	attempts: number;
};

// #endregion

// #region helpers

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

async function agentEmailHash(email: string, env: any): Promise<string> {
	return await hmacSha256(env.HMAC_SECRET, email.trim().toLowerCase());
}

// resolve the public site base url (email setting wins, then env) for building invite links
async function siteBaseUrl(env: any): Promise<string> {
	const email = await getEmailSettings();
	const url = email.site_url || env?.NUXT_PUBLIC_SITE_URL;
	return typeof url === 'string' && url.length > 0
		? url.replace(/\/$/, '')
		: 'https://smoke.pages.dev';
}

export async function inviteUrl(token: string, env: any): Promise<string> {
	return `${await siteBaseUrl(env)}/join/${token}`;
}

// derive the state of an invite without mutating it
export function inviteStatus(invite: AgentInvite | null): AgentInviteStatus {
	if (!invite) return 'not_found';
	if (Date.now() > invite.expires) return 'expired';
	if (invite.uses >= invite.maxUses) return 'exhausted';
	return 'valid';
}

// #endregion

// #region invites

export async function createAgentInvite(
	options: { email?: string; createdBy: string; ttlMinutes?: number; maxUses?: number },
	// env reserved for a future setting-overridable default ttl; kept for a stable signature
	env: any
): Promise<{ token: string; invite: AgentInvite }> {
	void env;
	const ttlMinutes = clamp(
		Math.round(options.ttlMinutes ?? DEFAULT_INVITE_TTL_MINUTES),
		1,
		MAX_INVITE_TTL_MINUTES
	);
	const maxUses = clamp(Math.round(options.maxUses ?? DEFAULT_INVITE_MAX_USES), 1, MAX_INVITE_USES);
	const token = bytesToBase64Url(randomBytes(INVITE_TOKEN_BYTES));
	const now = Date.now();

	const invite: AgentInvite = {
		email: options.email?.trim().toLowerCase() || undefined,
		role: 'agent',
		createdBy: options.createdBy,
		createdAt: now,
		expires: now + ttlMinutes * 60_000,
		maxUses,
		uses: 0
	};

	await kv.set(inviteKey(token), JSON.stringify(invite), { ttl: ttlMinutes * 60 });
	return { token, invite };
}

export async function getAgentInvite(token: string): Promise<AgentInvite | null> {
	if (!token) return null;
	// 'json' hints the kv backend to parse; unstorage's overloads reject the positional for object
	// types, so cast the arg (runtime-significant) + the result
	return (await kv.get(inviteKey(token), 'json' as never)) as AgentInvite | null;
}

// increment uses; delete once exhausted or expired. throws if it wasn't consumable
export async function consumeAgentInvite(token: string, env: any): Promise<AgentInvite> {
	void env;
	const invite = await getAgentInvite(token);
	const status = inviteStatus(invite);
	if (status !== 'valid') {
		// prune a dead record so it can't linger past its ttl on a slow backend
		if (invite) await kv.del(inviteKey(token));
		throw createError({ statusCode: 400, message: 'This invite link is no longer valid' });
	}

	const updated: AgentInvite = { ...invite!, uses: invite!.uses + 1 };
	if (updated.uses >= updated.maxUses) {
		await kv.del(inviteKey(token));
	} else {
		const remaining = Math.max(1, Math.ceil((updated.expires - Date.now()) / 1000));
		await kv.set(inviteKey(token), JSON.stringify(updated), { ttl: remaining });
	}

	return updated;
}

// #endregion

// #region password reset

function generateResetCode(): string {
	const bytes = randomBytes(4);
	const num = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
	return String(num % 10 ** RESET_CODE_LENGTH).padStart(RESET_CODE_LENGTH, '0');
}

// mint + email an 8-digit reset code; silent for an unknown email so account existence never leaks
export async function requestAgentPasswordReset(email: string, env: any): Promise<void> {
	ensureCollegeDB(env);
	const normalized = email.trim().toLowerCase();
	if (!normalized) return;

	const emailHash = await agentEmailHash(normalized, env);

	// short cooldown so one address can't be flooded with codes; still return quietly
	const cooling = await kv.get<string>(resetCooldownKey(emailHash));
	if (cooling) return;

	const user = await getUserByEmail(normalized, env).catch(() => null);
	if (!user) return;

	const code = generateResetCode();
	const record: ResetRecord = { code, expires: Date.now() + RESET_TTL_SECONDS * 1000, attempts: 0 };
	await kv.set(resetKey(emailHash), JSON.stringify(record), { ttl: RESET_TTL_SECONDS });
	await kv.set(resetCooldownKey(emailHash), '1', { ttl: RESET_COOLDOWN_SECONDS });

	const subject = 'Your Password Reset Code';
	const body =
		`Your staff password reset code is ${code}\n\n` +
		`Enter it to choose a new password. The code expires in ${RESET_TTL_SECONDS / 60} minutes.\n\n` +
		`If you did not request this, you can ignore this email; your password will stay the same.`;
	await sendCustomerEmail(normalized, subject, body, env);
}

// validate a code + set the new password; clears the code + all active sessions on success
export async function verifyAgentPasswordReset(
	email: string,
	code: string,
	newPassword: string,
	env: any
): Promise<void> {
	ensureCollegeDB(env);
	const normalized = email.trim().toLowerCase();
	const emailHash = await agentEmailHash(normalized, env);

	// 'json' hints the kv backend to parse; unstorage's overloads reject the positional for object
	// types, so cast the arg (runtime-significant) + the result
	const raw = (await kv.get(resetKey(emailHash), 'json' as never)) as ResetRecord | null;
	if (!raw) {
		throw createError({ statusCode: 400, message: 'Invalid or Expired Code' });
	}

	if (Date.now() > raw.expires) {
		await kv.del(resetKey(emailHash));
		throw createError({ statusCode: 400, message: 'Invalid or Expired Code' });
	}

	if (raw.attempts >= RESET_MAX_ATTEMPTS) {
		await kv.del(resetKey(emailHash));
		throw createError({ statusCode: 429, message: 'Too Many Attempts, Request a New Code' });
	}

	if (code.trim() !== raw.code) {
		const remaining = Math.max(1, Math.ceil((raw.expires - Date.now()) / 1000));
		await kv.set(resetKey(emailHash), JSON.stringify({ ...raw, attempts: raw.attempts + 1 }), {
			ttl: remaining
		});
		throw createError({ statusCode: 400, message: 'Invalid or Expired Code' });
	}

	const user = await getUserByEmail(normalized, env).catch(() => null);
	if (!user) {
		await kv.del(resetKey(emailHash));
		throw createError({ statusCode: 400, message: 'Invalid or Expired Code' });
	}

	await setUserPassword(user.id, newPassword);
	await Promise.all([kv.del(resetKey(emailHash)), kv.del(resetCooldownKey(emailHash))]);
	// force re-login everywhere; a reset should not leave stale sessions alive
	await deleteSessionTokens(user.id).catch(() => {});
}

// #endregion
