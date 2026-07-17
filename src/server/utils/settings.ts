import type { EncryptionAlgorithm } from './encryption';
import { PBKDF2_MAX_ITERATIONS, PBKDF2_MIN_ITERATIONS, setPbkdf2Iterations } from './encryption';

// #region keys + types

const PREFIX = 'smoke:setting:';
const settingKey = (k: string) => `${PREFIX}${k}`;

// branding/social strings, safe to expose to clients
export const STRING_SETTING_KEYS = [
	'name',
	'description',
	'themeColor',
	'favicon',
	'faviconPng',
	'website',
	'supportEmail',
	'github',
	'twitter',
	'discord',
	'linkedin',
	'instagram',
	'patreon'
] as const;

// structured settings stored as json
const JSON_SETTING_KEYS = [
	'email',
	'cloudflare',
	'branding',
	'features',
	'visibility',
	'custom_fields',
	'flows',
	'projects',
	'retention',
	'audit',
	'locking',
	'automation',
	'ai',
	'role_icons',
	'role_colors',
	'avatars',
	'security',
	'bimi'
] as const;

// default workers ai model; agent verifies against the live catalog at build time
export const DEFAULT_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// default ticket visibility per creation source; all private unless an admin opts in
export type VisibilityDefaults = {
	guest: 'public' | 'internal' | 'private';
	emailed: 'public' | 'internal' | 'private';
	team: 'public' | 'internal' | 'private';
};

export type SmtpTlsMode = 'implicit' | 'starttls' | 'off';

// custom smtp transport; password sealed at rest
export type SmtpConfig = {
	host: string;
	port: number;
	tls: SmtpTlsMode;
	username?: string;
	from: string;
};

export type EmailSettings = {
	// 'cloudflare' uses the email service polyfill; 'smtp' uses a custom server
	transport?: 'cloudflare' | 'smtp';
	support_email?: string;
	site_url?: string;
	team_inbox?: string;
	forward_to_agents?: boolean;
	default_reply_identity?: 'self' | 'team';
	// event notifications for non-email-thread tickets; on unless explicitly false
	notifications?: boolean;
	// inbound poll channel (imap/pop3) for self-hosters not on cloudflare email routing;
	// password is sealed separately (never in the type), exactly like SmtpConfig
	poll?: {
		enabled?: boolean;
		protocol?: 'imap' | 'pop3';
		host?: string;
		port?: number;
		tls?: SmtpTlsMode;
		username?: string;
	};
	smtp?: SmtpConfig;
};

export type CloudflareSettings = {
	account_id?: string;
	token_last4?: string;
	scopes?: string[];
	zone_id?: string;
	worker_name?: string;
};

// retention lifecycle; both null = keep forever. delete is destructive (advise against)
export type RetentionSettings = {
	archive_days: number | null;
	delete_days: number | null;
};

// audit-log retention; null = keep forever (default)
export type AuditSettings = {
	retention_days: number | null;
};

// thread-locking behavior
export type LockingSettings = {
	auto_lock_on_close: boolean;
	customer_reopen: boolean;
};

// identity automated flow messages post as; 'automation' uses the favicon + a display name
export type AutomationSettings = {
	identity: 'team' | 'automation';
	name: string;
};

// cloudflare-ai reply config; reuses the linked account id + api token (no new secret)
export type AiSettings = {
	enabled: boolean;
	model: string;
	system_append?: string;
	temperature?: number;
	max_tokens?: number;
};

// bimi brand-logo config: an iconify icon + fixed colors, rendered as a BIMI-compliant svg served
// at /bimi/logo.svg for the default._bimi dns record (colors must be hex; BIMI forbids css/currentColor)
export type BimiSettings = {
	enabled: boolean;
	icon: string;
	fill: string;
	background: string;
	stroke_color: string;
	stroke_width: number;
	title: string;
};

// per-role default avatar icon (iconify name) applied when a user has no avatar
export type RoleIcons = Partial<Record<'agent' | 'manager' | 'admin', string>>;

// per-role avatar color (nuxt ui theme token); only applies to icon avatars
export type AvatarColor =
	'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';
export type RoleColors = Partial<Record<'agent' | 'manager' | 'admin', AvatarColor>>;

// what agents may do with their OWN avatar; managers/owners can always set an agent's avatar.
// agent_can_change=false -> agents can't touch their avatar at all; agent_can_upload=false ->
// agents may pick an icon/url but not upload an image
export type AvatarPolicy = {
	agent_can_change: boolean;
	agent_can_upload: boolean;
};

// resolved outbound transport the email sender uses. `provider` picks the send mechanism:
// 'smtp' = edgeport over TCP (custom/external hosts); 'cloudflare' = the Email Sending REST api
// (workers can't tcp-connect to smtp.mx.cloudflare.net, a cloudflare IP)
export type ResolvedTransport = {
	provider: 'cloudflare' | 'smtp';
	hostname: string;
	port: number;
	tls: SmtpTlsMode;
	auth?: { username: string; password: string; mechanism?: 'PLAIN' | 'LOGIN' };
	from: string;
	// cloudflare rest send needs the account id (resolved alongside the token)
	accountId?: string;
};

type SealedSecret = {
	data: string;
	wrapped_dek: string;
	nonce: string;
	tag: string;
	algorithm: EncryptionAlgorithm;
	version: number;
};

// #endregion

// #region secret sealing

function b64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) {
		const b = bytes[i];
		if (b === undefined) continue; // shouldn't happen but just in case - avoid !b to not treat 0 as undefined
		binary += String.fromCharCode(b);
	}
	return btoa(binary);
}

function unb64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

// seal a secret string with the master key so tokens/passwords never sit in kv as plaintext
export async function sealSecret(value: string, masterKey: string): Promise<SealedSecret> {
	const sealed = await encrypt({ v: value }, masterKey);
	return {
		data: b64(sealed.ciphertext),
		wrapped_dek: b64(sealed.wrapped_dek),
		nonce: b64(sealed.nonce),
		tag: b64(sealed.tag),
		algorithm: sealed.algorithm,
		version: sealed.version
	};
}

export async function openSecret(sealed: SealedSecret, masterKey: string): Promise<string> {
	const out = (await decrypt(
		{
			data: unb64(sealed.data),
			wrapped_dek: unb64(sealed.wrapped_dek),
			nonce: unb64(sealed.nonce),
			tag: unb64(sealed.tag),
			algorithm: sealed.algorithm,
			version: sealed.version
		},
		masterKey
	)) as { v?: string };
	return typeof out?.v === 'string' ? out.v : '';
}

// last-4 for display without revealing the secret
export function last4(value: string): string {
	return value.length <= 4 ? value : value.slice(-4);
}

// kv key holding the sealed inbound poll password (mirrors email_smtp_password)
const POLL_PASSWORD_KEY = settingKey('email_poll_password');

// seal the inbound poll password under the master key; callers gate empty values so an
// absent password never overwrites an existing sealed one (same rule as the smtp password)
export async function sealEmailPollPassword(value: string, masterKey: string): Promise<void> {
	const sealed = await sealSecret(value, masterKey);
	await kv.set(POLL_PASSWORD_KEY, JSON.stringify(sealed));
	await invalidateSettings();
}

// #endregion

// #region get/set

async function getJson<T>(name: (typeof JSON_SETTING_KEYS)[number], fallback: T): Promise<T> {
	try {
		const raw = await kv.get<T>(settingKey(name), 'json');
		return raw != null ? (raw as T) : fallback;
	} catch {
		return fallback;
	}
}

export async function getStringSetting(name: string): Promise<string | null> {
	try {
		return (await kv.get<string>(settingKey(name))) ?? null;
	} catch {
		return null;
	}
}

export async function setStringSetting(name: string, value: string): Promise<void> {
	await kv.set(settingKey(name), value);
	await invalidateSettings();
}

export async function setJsonSetting(
	name: (typeof JSON_SETTING_KEYS)[number],
	value: unknown
): Promise<void> {
	await kv.set(settingKey(name), JSON.stringify(value));
	await invalidateSettings();
}

export async function getEmailSettings(): Promise<EmailSettings> {
	return getJson('email', {} as EmailSettings);
}

export async function getCloudflareSettings(): Promise<CloudflareSettings> {
	return getJson('cloudflare', {} as CloudflareSettings);
}

export async function getVisibilityDefaults(): Promise<VisibilityDefaults> {
	const stored = await getJson<Partial<VisibilityDefaults>>('visibility', {});
	return {
		guest: stored.guest ?? 'private',
		emailed: stored.emailed ?? 'private',
		team: stored.team ?? 'private'
	};
}

export async function getRetentionSettings(): Promise<RetentionSettings> {
	const stored = await getJson<Partial<RetentionSettings>>('retention', {});
	return {
		archive_days: stored.archive_days ?? 90,
		delete_days: stored.delete_days ?? null
	};
}

export async function getAuditSettings(): Promise<AuditSettings> {
	const stored = await getJson<Partial<AuditSettings>>('audit', {});
	return {
		retention_days: stored.retention_days ?? null
	};
}

export async function getLockingSettings(): Promise<LockingSettings> {
	const stored = await getJson<Partial<LockingSettings>>('locking', {});
	return {
		auto_lock_on_close: stored.auto_lock_on_close ?? false,
		customer_reopen: stored.customer_reopen ?? true
	};
}

export async function getAutomationSettings(): Promise<AutomationSettings> {
	const stored = await getJson<Partial<AutomationSettings>>('automation', {});
	return {
		identity: stored.identity === 'automation' ? 'automation' : 'team',
		name: stored.name || 'Automation'
	};
}

export async function getAiSettings(): Promise<AiSettings> {
	const stored = await getJson<Partial<AiSettings>>('ai', {});
	return {
		enabled: stored.enabled === true,
		model: stored.model || DEFAULT_AI_MODEL,
		system_append: typeof stored.system_append === 'string' ? stored.system_append : undefined,
		temperature: typeof stored.temperature === 'number' ? stored.temperature : undefined,
		max_tokens: typeof stored.max_tokens === 'number' ? stored.max_tokens : undefined
	};
}

export async function getBimiSettings(): Promise<BimiSettings> {
	const stored = await getJson<Partial<BimiSettings>>('bimi', {});
	return {
		enabled: stored.enabled === true,
		icon: typeof stored.icon === 'string' ? stored.icon : '',
		fill: typeof stored.fill === 'string' ? stored.fill : '',
		background: typeof stored.background === 'string' ? stored.background : '',
		stroke_color: typeof stored.stroke_color === 'string' ? stored.stroke_color : '',
		stroke_width: typeof stored.stroke_width === 'number' ? stored.stroke_width : 0,
		title: typeof stored.title === 'string' ? stored.title : ''
	};
}

export async function getRoleIcons(): Promise<RoleIcons> {
	return await getJson<RoleIcons>('role_icons', {});
}

export async function getRoleColors(): Promise<RoleColors> {
	return await getJson<RoleColors>('role_colors', {});
}

export async function getAvatarPolicy(): Promise<AvatarPolicy> {
	const stored = await getJson<Partial<AvatarPolicy>>('avatars', {});
	return {
		agent_can_change: stored.agent_can_change ?? true,
		agent_can_upload: stored.agent_can_upload ?? true
	};
}

export type SecuritySettings = {
	// pbkdf2 iteration count for envelope-encryption kek derivation; default is the workers max
	pbkdf2_iterations: number;
};

export async function getSecuritySettings(): Promise<SecuritySettings> {
	const stored = await getJson<Partial<SecuritySettings>>('security', {});
	const raw =
		typeof stored.pbkdf2_iterations === 'number' ? stored.pbkdf2_iterations : PBKDF2_MAX_ITERATIONS;
	const pbkdf2_iterations = Math.min(
		PBKDF2_MAX_ITERATIONS,
		Math.max(PBKDF2_MIN_ITERATIONS, Math.floor(raw))
	);
	// keep the crypto module's active count in sync with the persisted preference
	setPbkdf2Iterations(pbkdf2_iterations);
	return { pbkdf2_iterations };
}

// full public-safe settings for the settings api + client store (never secrets). read on nearly
// every page, so it's cached short-term and busted by every settings write (setString/setJson/seal)
export async function getAllSettings() {
	return await cache(SETTINGS_KEY, buildAllSettings, 60);
}

async function buildAllSettings() {
	const strings: Partial<Record<(typeof STRING_SETTING_KEYS)[number], string>> = {};
	await Promise.all(
		STRING_SETTING_KEYS.map(async (k) => {
			const v = await getStringSetting(k);
			if (v != null) strings[k] = v;
		})
	);
	const [
		email,
		cloudflare,
		branding,
		features,
		visibility,
		retention,
		audit,
		locking,
		automation,
		ai,
		roleIcons,
		roleColors,
		avatarPolicy,
		security,
		bimi
	] = await Promise.all([
		getEmailSettings(),
		getCloudflareSettings(),
		getJson<unknown>('branding', null),
		getJson<unknown>('features', null),
		getVisibilityDefaults(),
		getRetentionSettings(),
		getAuditSettings(),
		getLockingSettings(),
		getAutomationSettings(),
		getAiSettings(),
		getRoleIcons(),
		getRoleColors(),
		getAvatarPolicy(),
		getSecuritySettings(),
		getBimiSettings()
	]);
	// redact anything sensitive before it leaves the server
	const emailPublic: Record<string, unknown> = { ...email };
	if (emailPublic.smtp) {
		const s = emailPublic.smtp as SmtpConfig & { password?: unknown };
		emailPublic.smtp = {
			host: s.host,
			port: s.port,
			tls: s.tls,
			username: s.username,
			from: s.from
		};
	}
	// inbound poll never carries a password in the type, but strip defensively and surface a
	// has_password flag so the ui can show "configured" without ever leaking the sealed value
	if (emailPublic.poll) {
		const p = emailPublic.poll as Record<string, unknown>;
		const { password, ...pollRest } = p;
		void password;
		const pollSealed = await kv.get(POLL_PASSWORD_KEY, 'json').catch(() => null);
		emailPublic.poll = { ...pollRest, has_password: pollSealed != null };
	}
	return {
		...strings,
		email: emailPublic,
		cloudflare,
		branding,
		features,
		visibility,
		retention,
		audit,
		locking,
		automation,
		ai,
		role_icons: roleIcons,
		role_colors: roleColors,
		avatars: avatarPolicy,
		security,
		bimi
	};
}

// #endregion

// #region email transport resolution

function envSmtpOverride(env: any): ResolvedTransport | null {
	const host = env?.SMTP_HOST;
	if (typeof host !== 'string' || host.length === 0) return null;
	const from = env?.SMTP_FROM || env?.SUPPORT_EMAIL || `support@${host}`;
	const username = env?.SMTP_USER;
	return {
		provider: 'smtp',
		hostname: host,
		port: env?.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
		tls: (env?.SMTP_TLS as SmtpTlsMode) || 'starttls',
		auth: username ? { username, password: env?.SMTP_PASS || '', mechanism: 'PLAIN' } : undefined,
		from
	};
}

// the cloudflare api token, honoring the CF_EMAIL_TOKEN -> CF_API_TOKEN rename (back-compat)
export function cloudflareApiToken(env: any): string {
	return String(env?.CF_API_TOKEN || env?.CF_EMAIL_TOKEN || '');
}

export async function resolveCloudflareToken(env: any): Promise<string> {
	const masterKey = env?.MASTER_KEY;
	if (masterKey) {
		const sealed = await kv
			.get<SealedSecret>(settingKey('cloudflare_token'), 'json')
			.catch(() => null);
		if (sealed) {
			const token = await openSecret(sealed, masterKey).catch(() => '');
			if (token) return token;
		}
	}
	return cloudflareApiToken(env) || '';
}

export async function getEmailConfig(env: any): Promise<ResolvedTransport | null> {
	const override = envSmtpOverride(env);
	if (override) return override;

	const email = await getEmailSettings();
	const masterKey = env?.MASTER_KEY;

	// custom smtp when explicitly configured
	if (email.transport === 'smtp' && email.smtp?.host && masterKey) {
		const sealed = await kv
			.get<SealedSecret>(settingKey('email_smtp_password'), 'json')
			.catch(() => null);
		const password = sealed ? await openSecret(sealed, masterKey).catch(() => '') : '';
		return {
			provider: 'smtp',
			hostname: email.smtp.host,
			port: email.smtp.port,
			tls: email.smtp.tls,
			auth: email.smtp.username
				? { username: email.smtp.username, password, mechanism: 'PLAIN' }
				: undefined,
			from: email.smtp.from
		};
	}

	// cloudflare email service polyfill (default); sealed/linked token first, then env (see helper).
	// reading env-only here made a linked account report "configured" but fail to actually send
	// (test-email + real agent replies)
	const token = await resolveCloudflareToken(env);
	const support = email.support_email || env?.SUPPORT_EMAIL;
	if (token && support) {
		const cf = await getCloudflareSettings();
		return {
			provider: 'cloudflare',
			hostname: 'smtp.mx.cloudflare.net',
			port: 465,
			tls: 'implicit',
			auth: { username: 'api_token', password: token, mechanism: 'PLAIN' },
			from: `Support <${support}>`,
			accountId: cf.account_id
		};
	}

	return null;
}

// resolved inbound poll config the email poller connects with
export type InboundPollConfig = {
	protocol: 'imap' | 'pop3';
	connectOptions: {
		hostname?: string;
		port?: number;
		tls: SmtpTlsMode;
		auth: { username: string; password: string };
	};
	support: string;
};

// resolve the inbound poll channel: sealed-kv creds first, env POLL_USER/POLL_PASS as fallback.
// returns null when polling is disabled so callers can early-return
export async function getInboundPollConfig(env: any): Promise<InboundPollConfig | null> {
	const email = await getEmailSettings();
	if (!email.poll?.enabled) return null;

	const username = email.poll.username || env?.POLL_USER || '';

	let password = '';
	if (env?.MASTER_KEY) {
		const sealed = await kv.get<SealedSecret>(POLL_PASSWORD_KEY, 'json').catch(() => null);
		if (sealed) password = await openSecret(sealed, env.MASTER_KEY).catch(() => '');
	}
	if (!password) password = env?.POLL_PASS || '';

	const support = email.support_email || env?.SUPPORT_EMAIL || '';

	return {
		protocol: email.poll.protocol ?? 'imap',
		connectOptions: {
			hostname: email.poll.host,
			port: email.poll.port,
			tls: email.poll.tls ?? 'implicit',
			auth: { username, password }
		},
		support
	};
}

// #endregion
