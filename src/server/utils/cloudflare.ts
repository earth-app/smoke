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

export type CfDnsRecord = {
	type: string;
	name: string;
	content: string;
	priority?: number;
	id?: string;
};
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

// permission strings match Cloudflare's actual token permission-group names (Account/Zone > Group >
// level). keywords are only used by the fallback keyword matcher; live detection probes the api
export const CF_CAPABILITIES = [
	{
		key: 'send',
		label: 'Send Outbound Email',
		permission: 'Account > Email Sending > Edit',
		keywords: ['email', 'send'],
		description: 'Send agent replies and auto-acknowledgements via Cloudflare Email Service.'
	},
	{
		key: 'routing',
		label: 'Inbound Email Routing',
		permission: 'Zone > Email Routing > Edit + Account > Email Routing Addresses > Edit',
		keywords: ['email', 'routing'],
		description: 'Turn inbound customer emails into tickets via a catch-all rule.'
	},
	{
		key: 'dns',
		label: 'Auto-Configure DNS',
		permission: 'Zone > DNS > Edit',
		keywords: ['dns'],
		description: 'Create the MX / SPF / DKIM records for your domain automatically.'
	},
	{
		key: 'workers',
		label: 'Deploy Email Worker',
		permission: 'Account > Workers Scripts > Edit',
		keywords: ['workers', 'worker'],
		description: 'Provision the worker that receives mail and threads it into tickets.'
	},
	{
		key: 'ai',
		// keyword avoids matching 'email' (which contains 'ai'); real scopes are opaque policy ids
		label: 'AI-Powered Replies',
		permission: 'Account > Workers AI > Read',
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

// map best-effort token scopes to a per-feature granted/blocked matrix. NOTE: /user/tokens/verify
// returns only { status } (never the granted permission groups), so this keyword matcher gets [] in
// practice and reports everything blocked -- use probeCloudflareCapabilities for real detection
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

function capabilityMatrix(granted: Record<string, boolean>): CfCapability[] {
	return CF_CAPABILITIES.map((c) => ({
		key: c.key,
		label: c.label,
		permission: c.permission,
		description: c.description,
		granted: granted[c.key] ?? false
	}));
}

// per-zone probe of the zone-scoped perms inbound provisioning needs (dns edit + email routing).
// zone-scoped perms are usually granted on a SPECIFIC zone (the mail domain), not account-wide, so
// this reports EACH zone rather than a single account-level answer
export type ZoneCapability = { dns: boolean; routing: boolean };

async function cfOk(token: string, path: string): Promise<boolean> {
	try {
		await cfFetch(token, path, { method: 'GET' });
		return true;
	} catch {
		return false;
	}
}

export async function probeZoneCapabilities(
	token: string,
	zoneIds: string[]
): Promise<Record<string, ZoneCapability>> {
	if (MOCK) {
		return Object.fromEntries(zoneIds.map((z) => [z, { dns: true, routing: true }]));
	}
	const entries = await Promise.all(
		zoneIds.map(async (z) => {
			const [dns, routing] = await Promise.all([
				cfOk(token, `/zones/${z}/dns_records?per_page=1`),
				cfOk(token, `/zones/${z}/email/routing/rules?per_page=1`)
			]);
			return [z, { dns, routing }] as const;
		})
	);
	return Object.fromEntries(entries);
}

export async function probeCloudflareCapabilities(
	token: string,
	accountId: string,
	zoneCaps: Record<string, ZoneCapability> = {}
): Promise<CfCapability[]> {
	if (MOCK) {
		return capabilityMatrix({ send: true, routing: true, dns: true, workers: true, ai: true });
	}

	const [workers, ai, addresses] = await Promise.all([
		accountId
			? cfOk(token, `/accounts/${accountId}/workers/scripts?per_page=1`)
			: Promise.resolve(false),
		accountId
			? cfOk(token, `/accounts/${accountId}/ai/models/search?per_page=1`)
			: Promise.resolve(false),
		accountId
			? cfOk(token, `/accounts/${accountId}/email/routing/addresses?per_page=1`)
			: Promise.resolve(false)
	]);

	// a zone-scoped capability is granted if the token can do it on ANY zone (provisioning targets
	// whichever zone the user picks)
	const caps = Object.values(zoneCaps);
	const dns = caps.some((c) => c.dns);
	const routing = caps.some((c) => c.routing);

	return capabilityMatrix({
		// no rest endpoint verifies "Email Sending"; the account email-routing-address read is the
		// closest positive signal -- a heuristic, verified for real by the test-email flow
		send: addresses,
		// inbound needs the zone catch-all rule AND the account destination address
		routing: routing && addresses,
		dns,
		workers,
		ai
	});
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

// create or update a dns record in place (BIMI/DMARC records change content over time, so the
// create-only ensureEmailDnsRecords isn't enough). looks up an existing record by type+name, PUTs
// it when found else POSTs a new one
export async function upsertDnsRecord(
	token: string,
	zoneId: string,
	record: CfDnsRecord
): Promise<{ action: 'created' | 'updated'; id?: string }> {
	if (MOCK) return { action: 'created', id: 'mock-record' };
	let existing: Array<{ id: string }> = [];
	try {
		const q = `type=${encodeURIComponent(record.type)}&name=${encodeURIComponent(record.name)}`;
		existing = await cfFetch(token, `/zones/${zoneId}/dns_records?${q}`, { method: 'GET' });
	} catch {
		existing = [];
	}
	const match = (Array.isArray(existing) ? existing : [])[0];
	if (match?.id) {
		await cfFetch(token, `/zones/${zoneId}/dns_records/${match.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(record)
		});
		return { action: 'updated', id: match.id };
	}
	const created = await cfFetch<{ id?: string }>(token, `/zones/${zoneId}/dns_records`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(record)
	});
	return { action: 'created', id: created?.id };
}

export type DmarcStatus = {
	present: boolean;
	policy: 'none' | 'quarantine' | 'reject' | null;
	pct: number | null;
	// BIMI requires an enforcing policy (quarantine|reject) at full coverage
	enforced: boolean;
	record: string | null;
};

// pure classifier: is a dmarc TXT strong enough for BIMI? (p=quarantine|reject and pct null-or-100)
export function parseDmarcRecord(content: string | null): DmarcStatus {
	if (!content || !/v=DMARC1/i.test(content)) {
		return { present: false, policy: null, pct: null, enforced: false, record: null };
	}
	const policyRaw = content.match(/\bp=\s*(none|quarantine|reject)/i)?.[1]?.toLowerCase();
	const policy = (policyRaw as DmarcStatus['policy']) ?? null;
	const pctMatch = content.match(/\bpct=\s*(\d+)/i);
	const pct = pctMatch ? Number(pctMatch[1]) : null;
	const enforced =
		(policy === 'quarantine' || policy === 'reject') && (pct === null || pct === 100);
	return { present: true, policy, pct, enforced, record: content };
}

// read the _dmarc.<domain> TXT and classify whether it's strong enough for BIMI display
export async function getDmarcStatus(
	token: string,
	zoneId: string,
	domain: string
): Promise<DmarcStatus> {
	if (MOCK) return parseDmarcRecord('v=DMARC1; p=reject; pct=100');
	const name = `_dmarc.${domain}`;
	let records: Array<{ content: string }> = [];
	try {
		records = await cfFetch(
			token,
			`/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}`,
			{ method: 'GET' }
		);
	} catch {
		records = [];
	}
	const rec = (Array.isArray(records) ? records : [])
		.map((r) => r.content)
		.find((c) => /v=DMARC1/i.test(c));
	return parseDmarcRecord(rec ?? null);
}

export type BimiProvision = {
	domain: string;
	record: CfDnsRecord;
	action: 'created' | 'updated';
	logo_url: string;
	dmarc: DmarcStatus;
	dmarc_created: boolean;
};

// publish default._bimi.<domain> -> our logo url. optionally add a default enforcing DMARC record
// when none exists (never downgrades or overwrites an owner-set policy)
export async function provisionBimi(
	token: string,
	zoneId: string,
	domain: string,
	logoUrl: string,
	opts?: { vmcUrl?: string; autoDmarc?: boolean }
): Promise<BimiProvision> {
	const vmc = opts?.vmcUrl ? ` a=${opts.vmcUrl};` : ' a=;';
	const record: CfDnsRecord = {
		type: 'TXT',
		name: `default._bimi.${domain}`,
		content: `v=BIMI1; l=${logoUrl};${vmc}`
	};
	const { action } = await upsertDnsRecord(token, zoneId, record);

	let dmarc = await getDmarcStatus(token, zoneId, domain);
	let dmarcCreated = false;
	if (opts?.autoDmarc && !dmarc.present) {
		await upsertDnsRecord(token, zoneId, {
			type: 'TXT',
			name: `_dmarc.${domain}`,
			content: 'v=DMARC1; p=quarantine; pct=100;'
		});
		dmarcCreated = true;
		dmarc = await getDmarcStatus(token, zoneId, domain);
	}

	return { domain, record, action, logo_url: logoUrl, dmarc, dmarc_created: dmarcCreated };
}

// read back the live default._bimi record for an honest status
export async function getBimiRecord(
	token: string,
	zoneId: string,
	domain: string
): Promise<string | null> {
	if (MOCK) return 'v=BIMI1; l=https://example.com/bimi/logo.svg; a=;';
	const name = `default._bimi.${domain}`;
	try {
		const records = await cfFetch<Array<{ content: string }>>(
			token,
			`/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}`,
			{ method: 'GET' }
		);
		return (
			(Array.isArray(records) ? records : [])
				.map((r) => r.content)
				.find((c) => /v=BIMI1/i.test(c)) ?? null
		);
	} catch {
		return null;
	}
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
