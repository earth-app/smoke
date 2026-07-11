const API_BASE = 'https://api.cloudflare.com/client/v4';

// process-local mock flag; routes call setMockCf(isMockCf(env)) before touching the api
let MOCK = false;

// mock switch: env is authoritative (workerd unit harness), with a runtimeConfig fallback
// so the flag baked in at build time still applies in the node e2e preview
export function isMockCf(env: any): boolean {
	if (String(env?.MOCK_CF) === '1' || env?.MOCK_CF === true) return true;
	try {
		return useRuntimeConfig().mockCf === true;
	} catch {
		return false;
	}
}

// arm/disarm the mock path; each cf route sets this from its env at request start
export function setMockCf(on: boolean): void {
	MOCK = on;
}

export function describeCfError(error: unknown): string {
	const seen = new Set<unknown>();
	let current: any = error;
	while (current && !seen.has(current)) {
		seen.add(current);
		if (Array.isArray(current?.errors) && current.errors.length) {
			// surface every error cloudflare returned (with codes) so a failure is never ambiguous
			const all = current.errors
				.map((e: any) => (e?.message ? `${e.message}${e.code ? ` [${e.code}]` : ''}` : null))
				.filter(Boolean);
			if (all.length) return all.join('; ');
		}
		if (current?.message) return current.message;
		current = current?.cause;
	}
	return String(error);
}

// turn a raw cf error into actionable guidance for the common token-permission rejection
export function explainCfError(error: unknown): string {
	const raw = describeCfError(error);
	const u = (error as any)?.url as string | undefined;
	const m = (error as any)?.method as string | undefined;
	const where = u ? ` (Request: ${m || 'GET'} ${u})` : '';
	if (
		/ACTION_NOT_AUTHORIZED|not authoriz|unauthoriz|permission|forbidden|authentication error/i.test(
			raw
		)
	) {
		return `${raw} - the Cloudflare API token is not authorized for this action. Create a token with "Email Routing: Edit", "DNS: Edit", and "Workers Routes: Edit" on this zone/account, then re-link.${where}`;
	}
	return `${raw}${where}`;
}

// http status attached to a thrown cf error (if any)
export function cfErrorStatus(error: unknown): number | undefined {
	const s = (error as any)?.status;
	return typeof s === 'number' ? s : undefined;
}

// a conflict means the record already exists; treat as success (already provisioned)
export function isBenignCfError(error: unknown): boolean {
	if (cfErrorStatus(error) === 409) return true;
	const msg = describeCfError(error).toLowerCase();
	return /already exist|duplicat|dedup|conflict|same record/.test(msg);
}

// dropped connections / 5xx are retryable rather than real failures
export function isTransientCfError(error: unknown): boolean {
	const status = cfErrorStatus(error);
	if (status && status >= 500) return true;
	const msg = describeCfError(error).toLowerCase();
	return /internal error|reference =|network connection|connection lost|connection reset|timed? ?out|fetch failed|terminated|socket|request failed/.test(
		msg
	);
}

async function cfFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
	// the url carries account/zone ids but never the token (that's an Authorization header)
	const url = `${API_BASE}${path}`;
	const method = String(init.method || 'GET').toUpperCase();
	let res: Response;
	try {
		res = await fetch(url, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				...(init.headers || {})
			}
		});
	} catch (e) {
		const err = new Error(`Cloudflare request failed: ${(e as Error)?.message ?? String(e)}`);
		(err as any).url = url;
		(err as any).method = method;
		throw err;
	}
	const text = await res.text();
	let json: any = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = { raw: text };
	}
	if (!res.ok || json?.success === false) {
		const err = new Error(describeCfError(json) || `Cloudflare error ${res.status}`);
		(err as any).status = res.status;
		(err as any).errors = json?.errors;
		(err as any).url = url;
		(err as any).method = method;
		throw err;
	}
	return (json?.result ?? json) as T;
}

export type CfDnsRecord = { type: string; name: string; content: string; priority?: number };
export type CfZone = { id: string; name: string };

// verify a token works when linking an account
export async function verifyToken(token: string): Promise<{ status?: string }> {
	if (MOCK) {
		if (/invalid/i.test(token)) {
			const err = new Error('Invalid API token') as any;
			err.status = 401;
			throw err;
		}
		return { status: 'active' };
	}
	return cfFetch<{ status?: string }>(token, `/user/tokens/verify`, { method: 'GET' });
}

// best-effort scope list from the verify endpoint
export async function getTokenScopes(token: string): Promise<string[]> {
	if (MOCK) return ['email', 'dns', 'workers', 'workers ai'];
	try {
		const v = await cfFetch<any>(token, `/user/tokens/verify`, { method: 'GET' });
		const scopes = v?.scopes ?? v?.policies;
		return Array.isArray(scopes) ? scopes.map((s: any) => String(s)) : [];
	} catch {
		return [];
	}
}

export const CF_CAPABILITIES = [
	{
		key: 'send',
		label: 'Send Outbound Email',
		permission: 'Email Sending: Send',
		keywords: ['email', 'send'],
		description: 'Send agent replies and auto-acknowledgements via Cloudflare Email Service.'
	},
	{
		key: 'routing',
		label: 'Inbound Email Routing',
		permission: 'Email Routing Addresses: Edit',
		keywords: ['email', 'routing'],
		description: 'Turn inbound customer emails into tickets via a catch-all rule.'
	},
	{
		key: 'dns',
		label: 'Auto-Configure DNS',
		permission: 'DNS: Edit',
		keywords: ['dns'],
		description: 'Create the MX / SPF / DKIM records for your domain automatically.'
	},
	{
		key: 'workers',
		label: 'Deploy Email Worker',
		permission: 'Workers Scripts: Edit',
		keywords: ['workers', 'worker'],
		description: 'Provision the worker that receives mail and threads it into tickets.'
	},
	{
		key: 'ai',
		// keyword avoids matching 'email' (which contains 'ai'); real scopes are opaque policy ids
		label: 'AI-Powered Replies',
		permission: 'Workers AI: Read',
		keywords: ['workers ai', 'workersai'],
		description: 'Draft support replies with Cloudflare AI models.'
	}
] as const;

export type CfCapability = {
	key: string;
	label: string;
	permission: string;
	description: string;
	granted: boolean;
};

// map best-effort token scopes to a per-feature granted/blocked matrix
export function cloudflareCapabilities(scopes: string[]): CfCapability[] {
	const lower = scopes.map((s) => s.toLowerCase());
	return CF_CAPABILITIES.map((c) => ({
		key: c.key,
		label: c.label,
		permission: c.permission,
		description: c.description,
		granted: c.keywords.some((k) => lower.some((s) => s.includes(k)))
	}));
}

export async function listZones(token: string, accountId: string): Promise<CfZone[]> {
	if (MOCK) return [{ id: 'zone-mock', name: 'example.com' }];
	const res = await cfFetch<CfZone[]>(token, `/zones?account.id=${encodeURIComponent(accountId)}`, {
		method: 'GET'
	});
	return Array.isArray(res) ? res.map((z) => ({ id: z.id, name: z.name })) : [];
}

export async function enableEmailRouting(token: string, zoneId: string): Promise<void> {
	if (MOCK) return;
	await cfFetch(token, `/zones/${zoneId}/email/routing/enable`, { method: 'POST' });
}

export async function getEmailRoutingDns(token: string, zoneId: string): Promise<CfDnsRecord[]> {
	if (MOCK) {
		return [
			{ type: 'MX', name: 'example.com', content: 'route1.mx.cloudflare.net', priority: 1 },
			{
				type: 'TXT',
				name: 'example.com',
				content: 'v=spf1 include:_spf.mx.cloudflare.net ~all'
			},
			{
				type: 'TXT',
				name: 'cf2024-1._domainkey.example.com',
				content: 'v=DKIM1; p=MOCKDKIMPUBLICKEY'
			}
		];
	}
	const res = await cfFetch<CfDnsRecord[]>(token, `/zones/${zoneId}/email/routing/dns`, {
		method: 'GET'
	});
	return Array.isArray(res) ? res : [];
}

export async function ensureEmailDnsRecords(
	token: string,
	zoneId: string,
	records: CfDnsRecord[]
): Promise<{ created: string[]; skipped: string[] }> {
	if (MOCK) return { created: records.map((r) => r.name), skipped: [] };
	const created: string[] = [];
	const skipped: string[] = [];
	for (const record of records) {
		try {
			await cfFetch(token, `/zones/${zoneId}/dns_records`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(record)
			});
			created.push(record.name);
		} catch (e) {
			if (isBenignCfError(e)) skipped.push(record.name);
			else throw e;
		}
	}
	return { created, skipped };
}

export async function upsertCatchAllToWorker(
	token: string,
	zoneId: string,
	workerName: string
): Promise<void> {
	if (MOCK) return;
	await cfFetch(token, `/zones/${zoneId}/email/routing/rules/catch_all`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			enabled: true,
			matchers: [{ type: 'all' }],
			actions: [{ type: 'worker', value: [workerName] }]
		})
	});
}

// worker scripts on the account; the script name is its id (the catch-all target)
export async function listWorkerScripts(
	token: string,
	accountId: string
): Promise<{ id: string }[]> {
	if (MOCK) return [{ id: 'smoke' }];
	const res = await cfFetch<any[]>(token, `/accounts/${accountId}/workers/scripts`, {
		method: 'GET'
	});
	return Array.isArray(res)
		? res.map((s) => ({ id: String(s?.id ?? s?.name ?? '') })).filter((s) => s.id.length > 0)
		: [];
}

// the zone's email routing catch-all rule (or null when none exists / it can't be read)
export type CfCatchAllRule = {
	enabled: boolean;
	actions: { type: string; value?: string[] }[];
	matchers: { type: string }[];
};

export async function getCatchAllRule(
	token: string,
	zoneId: string
): Promise<CfCatchAllRule | null> {
	if (MOCK) return null;
	const res = await cfFetch<any>(token, `/zones/${zoneId}/email/routing/rules/catch_all`, {
		method: 'GET'
	});
	if (!res || typeof res !== 'object') return null;
	return {
		enabled: Boolean(res.enabled),
		actions: Array.isArray(res.actions) ? res.actions : [],
		matchers: Array.isArray(res.matchers) ? res.matchers : []
	};
}

export async function listDestinationAddresses(
	token: string,
	accountId: string
): Promise<{ email: string }[]> {
	if (MOCK) return [];
	const res = await cfFetch<{ email: string }[]>(
		token,
		`/accounts/${accountId}/email/routing/addresses`,
		{ method: 'GET' }
	);
	return Array.isArray(res) ? res : [];
}

export async function addDestinationAddress(
	token: string,
	accountId: string,
	email: string
): Promise<void> {
	if (MOCK) return;
	try {
		await cfFetch(token, `/accounts/${accountId}/email/routing/addresses`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email })
		});
	} catch (e) {
		if (!isBenignCfError(e)) throw e;
	}
}

// #region email sending (outbound onboarding)

// an email sending subdomain (zone-scoped); enabled means outbound is live for that domain
export type CfSendingSubdomain = { tag: string; name: string; enabled: boolean };

export type EmailSendingProvision = {
	domain: string;
	subdomain: string;
	enabled: boolean;
	records: CfDnsRecord[];
	created: string[];
	auto_created: boolean;
};

// list the zone's email sending subdomains (each carries enabled + a dkim selector)
export async function listSendingSubdomains(
	token: string,
	zoneId: string
): Promise<CfSendingSubdomain[]> {
	if (MOCK) return [{ tag: 'sub-mock', name: 'example.com', enabled: true }];
	const res = await cfFetch<any[]>(token, `/zones/${zoneId}/email/sending/subdomains`, {
		method: 'GET'
	});
	return Array.isArray(res)
		? res.map((s) => ({
				tag: String(s?.tag ?? s?.id ?? ''),
				name: String(s?.name ?? ''),
				enabled: Boolean(s?.enabled)
			}))
		: [];
}

// enable email sending for a domain; reuses an existing subdomain rather than duplicating it
export async function enableEmailSending(
	token: string,
	zoneId: string,
	domain: string
): Promise<CfSendingSubdomain> {
	if (MOCK) return { tag: 'sub-mock', name: domain, enabled: true };
	try {
		const existing = (await listSendingSubdomains(token, zoneId)).find(
			(s) => s.name.toLowerCase() === domain.toLowerCase()
		);
		if (existing) return existing;
	} catch {
		// fall through to create when the list can't be read
	}
	const res = await cfFetch<any>(token, `/zones/${zoneId}/email/sending/subdomains`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: domain })
	});
	return {
		tag: String(res?.tag ?? res?.id ?? ''),
		name: String(res?.name ?? domain),
		enabled: Boolean(res?.enabled)
	};
}

// the expected spf/dkim/mx records for a sending subdomain (what the user must add to dns)
export async function getEmailSendingDns(
	token: string,
	zoneId: string,
	subdomainId: string
): Promise<CfDnsRecord[]> {
	if (MOCK) {
		return [
			{ type: 'TXT', name: 'example.com', content: 'v=spf1 include:_spf.mx.cloudflare.net ~all' },
			{
				type: 'TXT',
				name: 'cf2024-1._domainkey.example.com',
				content: 'v=DKIM1; p=MOCKDKIMPUBLICKEY'
			},
			{ type: 'MX', name: 'example.com', content: 'route1.mx.cloudflare.net', priority: 1 }
		];
	}
	const res = await cfFetch<CfDnsRecord[]>(
		token,
		`/zones/${zoneId}/email/sending/subdomains/${subdomainId}/dns`,
		{ method: 'GET' }
	);
	return Array.isArray(res) ? res : [];
}

// whether the support domain is onboarded to email sending (an enabled matching subdomain)
export async function isEmailSendingVerified(
	token: string,
	zoneId: string,
	domain: string
): Promise<boolean> {
	// a provisioned zone counts as verified on the offline mock path
	if (MOCK) return Boolean(zoneId);
	if (!zoneId || !domain) return false;
	try {
		const d = domain.toLowerCase();
		const subs = await listSendingSubdomains(token, zoneId);
		return subs.some((s) => {
			const name = s.name.toLowerCase();
			return s.enabled && (name === d || d.endsWith(`.${name}`) || name.endsWith(`.${d}`));
		});
	} catch {
		return false;
	}
}

// enable email sending for the support domain and return the dns records to add. when
// autoDns is set (DNS: Edit granted) the spf/dkim/mx records are also created in the zone
export async function provisionEmailSending(
	token: string,
	zoneId: string,
	domain: string,
	opts: { autoDns?: boolean } = {}
): Promise<EmailSendingProvision> {
	if (MOCK) {
		const records: CfDnsRecord[] = [
			{ type: 'TXT', name: domain, content: 'v=spf1 include:_spf.mx.cloudflare.net ~all' },
			{
				type: 'TXT',
				name: `cf2024-1._domainkey.${domain}`,
				content: 'v=DKIM1; p=MOCKDKIMPUBLICKEY'
			},
			{ type: 'MX', name: domain, content: 'route1.mx.cloudflare.net', priority: 1 }
		];
		return {
			domain,
			subdomain: 'sub-mock',
			enabled: true,
			records,
			created: opts.autoDns ? records.map((r) => r.name) : [],
			auto_created: Boolean(opts.autoDns)
		};
	}

	const sub = await enableEmailSending(token, zoneId, domain);
	const records = await getEmailSendingDns(token, zoneId, sub.tag);
	let created: string[] = [];
	let autoCreated = false;
	if (opts.autoDns && records.length > 0) {
		const result = await ensureEmailDnsRecords(token, zoneId, records);
		created = result.created;
		autoCreated = true;
	}
	return {
		domain,
		subdomain: sub.tag,
		enabled: sub.enabled,
		records,
		created,
		auto_created: autoCreated
	};
}

// #endregion
