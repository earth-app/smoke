import type { EncryptionAlgorithm } from './encryption';

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
	'linkedin'
] as const;

// structured settings stored as json
const JSON_SETTING_KEYS = ['email', 'cloudflare', 'branding', 'features'] as const;

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
	// inbound poll channel (imap/pop3) for self-hosters not on cloudflare email routing
	poll?: {
		enabled?: boolean;
		protocol?: 'imap' | 'pop3';
		host?: string;
		port?: number;
		tls?: SmtpTlsMode;
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

// resolved outbound transport the email sender uses
export type ResolvedTransport = {
	hostname: string;
	port: number;
	tls: SmtpTlsMode;
	auth?: { username: string; password: string; mechanism?: 'PLAIN' | 'LOGIN' };
	from: string;
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
}

export async function setJsonSetting(
	name: (typeof JSON_SETTING_KEYS)[number],
	value: unknown
): Promise<void> {
	await kv.set(settingKey(name), JSON.stringify(value));
}

export async function getEmailSettings(): Promise<EmailSettings> {
	return getJson('email', {} as EmailSettings);
}

export async function getCloudflareSettings(): Promise<CloudflareSettings> {
	return getJson('cloudflare', {} as CloudflareSettings);
}

// full public-safe settings for the settings api + client store (never secrets)
export async function getAllSettings() {
	const strings: Record<string, string> = {};
	await Promise.all(
		STRING_SETTING_KEYS.map(async (k) => {
			const v = await getStringSetting(k);
			if (v != null) strings[k] = v;
		})
	);
	const [email, cloudflare, branding, features] = await Promise.all([
		getEmailSettings(),
		getCloudflareSettings(),
		getJson<unknown>('branding', null),
		getJson<unknown>('features', null)
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
	return { ...strings, email: emailPublic, cloudflare, branding, features };
}

// #endregion

// #region email transport resolution

function envSmtpOverride(env: any): ResolvedTransport | null {
	const host = env?.SMTP_HOST;
	if (typeof host !== 'string' || host.length === 0) return null;
	const from = env?.SMTP_FROM || env?.SUPPORT_EMAIL || `support@${host}`;
	const username = env?.SMTP_USER;
	return {
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

// resolve the active outbound transport: env override -> custom smtp -> cloudflare email service
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
			hostname: email.smtp.host,
			port: email.smtp.port,
			tls: email.smtp.tls,
			auth: email.smtp.username
				? { username: email.smtp.username, password, mechanism: 'PLAIN' }
				: undefined,
			from: email.smtp.from
		};
	}

	// cloudflare email service polyfill (default)
	const token = cloudflareApiToken(env);
	const support = email.support_email || env?.SUPPORT_EMAIL;
	if (token && support) {
		return {
			hostname: 'smtp.mx.cloudflare.net',
			port: 465,
			tls: 'implicit',
			auth: { username: 'api_token', password: token, mechanism: 'PLAIN' },
			from: `Support <${support}>`
		};
	}

	return null;
}

// #endregion
