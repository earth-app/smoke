import type { UnfurlPreview } from '~/shared/utils/unfurl';

// #region constants

const UNFURL_FETCH_TIMEOUT_MS = 5000;
// slice the body so a giant page can't blow the isolate memory budget
const UNFURL_MAX_BYTES = 512 * 1024;
// full previews live a day; thin/favicon-only ones expire sooner so an origin that
// starts serving og tags is picked up quickly
const UNFURL_CACHE_TTL = 60 * 60 * 24;
const UNFURL_THIN_TTL = 60 * 60;
// look like a real browser so origins don't serve a bot-blocking stub
const UNFURL_USER_AGENT =
	'Mozilla/5.0 (compatible; SmokeBot/1.0; +https://github.com/earth-app/smoke) link-preview';
const UNFURL_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 500;

const unfurlCacheKey = (hash: string) => `smoke:unfurl:${hash}`;

// #endregion

// #region ssrf guard

// dotted-decimal ipv4 -> octets, or null when it isn't one
function parseIpv4(host: string): [number, number, number, number] | null {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!m) return null;
	const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const;
	if (octets.some((o) => o > 255)) return null;
	return [octets[0], octets[1], octets[2], octets[3]];
}

// private/reserved ipv4 ranges we refuse to fetch
function isPrivateV4([a, b]: [number, number, number, number]): boolean {
	if (a === 0) return true; // 0.0.0.0/8 (incl. 0.0.0.0)
	if (a === 10) return true; // 10.0.0.0/8
	if (a === 127) return true; // 127.0.0.0/8 loopback
	if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. metadata 169.254.169.254)
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
	if (a === 192 && b === 168) return true; // 192.168.0.0/16
	if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 cgnat
	return false;
}

// expand an ipv6 literal (incl. :: compression + trailing dotted ipv4) to 8 x 16-bit hextets
function expandIpv6(raw: string): number[] | null {
	let s = (raw.split('%')[0] ?? '').toLowerCase(); // drop any zone id
	if (!s) return null;

	// fold a trailing dotted ipv4 (e.g. ::ffff:1.2.3.4) into two hextets
	let ipv4Tail: number[] = [];
	const dm = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
	if (dm) {
		const v4 = parseIpv4(dm[2]!);
		if (!v4) return null;
		ipv4Tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
		s = dm[1]!.replace(/:$/, '') || '::';
	}

	const hasDouble = s.includes('::');
	let headParts: string[] = [];
	let tailParts: string[] = [];
	if (hasDouble) {
		const [head = '', tail = ''] = s.split('::');
		headParts = head ? head.split(':') : [];
		tailParts = tail ? tail.split(':') : [];
	} else {
		headParts = s.split(':');
	}

	const toNums = (parts: string[]) =>
		parts.map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
	const headNums = toNums(headParts);
	const tailNums = toNums(tailParts);
	const explicit = headNums.length + tailNums.length + ipv4Tail.length;
	if (explicit > 8) return null;
	if (!hasDouble && explicit !== 8) return null;

	const all = [...headNums, ...new Array(8 - explicit).fill(0), ...tailNums, ...ipv4Tail];
	if (all.length !== 8 || all.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)) return null;
	return all;
}

// private/reserved ipv6 (loopback, unspecified, ula, link-local, ipv4-mapped equivalents)
function isPrivateV6(raw: string): boolean {
	const h = expandIpv6(raw);
	if (!h) {
		// unparseable; fall back to conservative prefix checks
		const s = (raw.split('%')[0] ?? '').toLowerCase();
		return s === '::1' || s === '::' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
	}
	if (h.every((x) => x === 0)) return true; // :: unspecified
	if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1 loopback
	if ((h[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
	if ((h[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	// ipv4-mapped ::ffff:a.b.c.d -> check the embedded v4
	if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
		const a = (h[6]! >> 8) & 0xff;
		const b = h[6]! & 0xff;
		const c = (h[7]! >> 8) & 0xff;
		const d = h[7]! & 0xff;
		if (isPrivateV4([a, b, c, d])) return true;
	}
	return false;
}

function isUnsafeHost(hostname: string): boolean {
	let host = hostname.toLowerCase();
	if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1); // unwrap ipv6 literal
	if (!host) return true;
	if (host === 'localhost') return true;
	if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;
	// bare integer or hex host is an obfuscated ip literal (e.g. 2130706433 = 127.0.0.1)
	if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) return true;
	const v4 = parseIpv4(host);
	if (v4) return isPrivateV4(v4);
	if (host.includes(':')) return isPrivateV6(host);
	return false;
}

/**
 * SSRF guard for a url we're about to fetch server-side. Rejects anything that isn't plain
 * http/https on port 80/443 pointed at a public host - no localhost, `.local`/`.internal`/`.lan`
 * suffixes, and no private/reserved ipv4/ipv6 literal (incl. the 169.254.169.254 metadata ip).
 * Unparseable input is unsafe.
 *
 * @example
 * isSafeUnfurlUrl('https://example.com') // true
 * isSafeUnfurlUrl('http://169.254.169.254') // false
 */
export function isSafeUnfurlUrl(raw: string): boolean {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return false;
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
	if (u.port && u.port !== '80' && u.port !== '443') return false;
	return !isUnsafeHost(u.hostname);
}

// #endregion

// #region html metadata extraction

// minimal html-entity decode covering the handful real pages emit
function decodeEntities(s: string): string {
	return s
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec) => fromCodePoint(parseInt(dec, 10)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&'); // last so &amp;lt; doesn't double-decode into <
}

function fromCodePoint(code: number): string {
	if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
	try {
		return String.fromCodePoint(code);
	} catch {
		return '';
	}
}

// read one attribute off a single tag string; tolerates single/double/unquoted values
function attr(tag: string, name: string): string | undefined {
	const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
	const m = re.exec(tag);
	if (!m) return undefined;
	return m[2] ?? m[3] ?? m[4];
}

// first <meta> whose property/name equals key (attribute order agnostic)
function getMeta(html: string, key: string): string | undefined {
	const lower = key.toLowerCase();
	const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
	for (const tag of tags) {
		const k = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
		if (k === lower) {
			const content = attr(tag, 'content');
			if (content != null) return content;
		}
	}
	return undefined;
}

function getTitleTag(html: string): string | undefined {
	const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	return m ? m[1] : undefined;
}

// prefer a real icon/shortcut-icon link, fall back to apple-touch-icon
function findFavicon(html: string): string | undefined {
	const tags = html.match(/<link\b[^>]*>/gi) ?? [];
	let iconHref: string | undefined;
	let appleHref: string | undefined;
	for (const tag of tags) {
		const rel = (attr(tag, 'rel') ?? '').toLowerCase();
		const href = attr(tag, 'href');
		if (!href) continue;
		const tokens = rel.split(/\s+/);
		if (tokens.includes('icon'))
			iconHref ??= href; // covers "icon" and "shortcut icon"
		else if (rel.includes('apple-touch-icon')) appleHref ??= href;
	}
	const found = iconHref ?? appleHref;
	return found ? decodeEntities(found).trim() : undefined;
}

// all ld+json blocks, flattening a top-level array or an @graph container
function parseJsonLd(html: string): Record<string, any>[] {
	const out: Record<string, any>[] = [];
	const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		const raw = (m[1] ?? '').trim();
		if (!raw) continue;
		try {
			const parsed = JSON.parse(raw);
			const graph = parsed && !Array.isArray(parsed) ? parsed['@graph'] : undefined;
			const items = Array.isArray(parsed) ? parsed : Array.isArray(graph) ? graph : [parsed];
			for (const item of items) {
				if (item && typeof item === 'object') out.push(item as Record<string, any>);
			}
		} catch {
			// skip a malformed block; other blocks may still parse
		}
	}
	return out;
}

function ldImage(obj: Record<string, any>): string | undefined {
	const img = obj?.image;
	if (!img) return undefined;
	if (typeof img === 'string') return img;
	if (Array.isArray(img)) {
		const first = img[0];
		if (typeof first === 'string') return first;
		if (first && typeof first === 'object' && typeof first.url === 'string') return first.url;
		return undefined;
	}
	if (typeof img === 'object' && typeof img.url === 'string') return img.url;
	return undefined;
}

function ldPublisherName(obj: Record<string, any>): string | undefined {
	const p = obj?.publisher;
	if (!p) return undefined;
	if (typeof p === 'string') return p;
	if (typeof p === 'object' && typeof p.name === 'string') return p.name;
	return undefined;
}

// first non-empty candidate, entity-decoded + trimmed
function firstText(...vals: (string | undefined)[]): string | undefined {
	for (const v of vals) {
		if (typeof v !== 'string') continue;
		const t = decodeEntities(v).trim();
		if (t) return t;
	}
	return undefined;
}

function resolveUrl(raw: string | undefined, base: string): string | undefined {
	if (!raw) return undefined;
	try {
		return new URL(raw.trim(), base).toString();
	} catch {
		return undefined;
	}
}

function hostnameOf(finalUrl: string): string | undefined {
	try {
		return new URL(finalUrl).hostname || undefined;
	} catch {
		return undefined;
	}
}

function faviconFallback(finalUrl: string): string | undefined {
	try {
		return `${new URL(finalUrl).origin}/favicon.ico`;
	} catch {
		return undefined;
	}
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max) : s;
}

/**
 * Pure, network-free metadata parser. Extracts title/description/image/siteName/favicon from a
 * page body, preferring OpenGraph, then Twitter cards, then schema.org (ld+json), then plain html.
 * Relative image/favicon urls resolve against `finalUrl`. Never throws - returns `{ url: finalUrl }`
 * on any failure.
 *
 * @example
 * extractMetadata('<meta property="og:title" content="Hi">', 'https://x.com').title // 'Hi'
 */
export function extractMetadata(html: string, finalUrl: string): UnfurlPreview {
	const preview: UnfurlPreview = { url: finalUrl };
	try {
		const ld = parseJsonLd(html);
		const ldObj =
			ld.find((o) => o.name || o.headline || o.description || o.image) ??
			({} as Record<string, any>);

		const title = firstText(
			getMeta(html, 'og:title'),
			getMeta(html, 'twitter:title'),
			typeof ldObj.name === 'string'
				? ldObj.name
				: typeof ldObj.headline === 'string'
					? ldObj.headline
					: undefined,
			getTitleTag(html)
		);
		if (title) preview.title = truncate(title, TITLE_MAX);

		const description = firstText(
			getMeta(html, 'og:description'),
			getMeta(html, 'twitter:description'),
			typeof ldObj.description === 'string' ? ldObj.description : undefined,
			getMeta(html, 'description')
		);
		if (description) preview.description = truncate(description, DESCRIPTION_MAX);

		const imageRaw = firstText(
			getMeta(html, 'og:image'),
			getMeta(html, 'og:image:url'),
			getMeta(html, 'twitter:image'),
			getMeta(html, 'twitter:image:src'),
			ldImage(ldObj)
		);
		const image = resolveUrl(imageRaw, finalUrl);
		if (image) preview.image = image;

		const siteName = firstText(
			getMeta(html, 'og:site_name'),
			ldPublisherName(ldObj),
			hostnameOf(finalUrl)
		);
		if (siteName) preview.siteName = siteName;

		const favicon = resolveUrl(findFavicon(html), finalUrl) ?? faviconFallback(finalUrl);
		if (favicon) preview.favicon = favicon;
	} catch {
		return { url: finalUrl };
	}
	return preview;
}

// #endregion

// #region fetch + cache

async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(input));
	return bytesToHex(new Uint8Array(digest));
}

async function readUnfurlCache(key: string): Promise<UnfurlPreview | null> {
	try {
		const raw = await kv.get<string>(key);
		if (typeof raw === 'string') return JSON.parse(raw) as UnfurlPreview;
	} catch {
		// corrupt/missing entry; treat as a miss
	}
	return null;
}

async function writeUnfurlCache(key: string, value: UnfurlPreview, ttl: number): Promise<void> {
	try {
		await kv.set(key, JSON.stringify(value), { ttl });
	} catch {
		// caching is best-effort; a write failure must not fail the request
	}
}

// do the network fetch + parse; null on timeout, network error, or a redirect to an unsafe host
async function performUnfurl(url: string): Promise<UnfurlPreview | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), UNFURL_FETCH_TIMEOUT_MS);
	let res: Response;
	try {
		res = await fetch(url, {
			signal: controller.signal,
			redirect: 'follow',
			headers: { 'User-Agent': UNFURL_USER_AGENT, Accept: UNFURL_ACCEPT }
		});
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}

	// a redirect could have landed on a private host; re-check the final url
	const finalUrl = res.url || url;
	if (!isSafeUnfurlUrl(finalUrl)) return null;

	const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
	// only parse html; anything else gets a favicon-only thin preview
	if (contentType && !contentType.includes('text/html')) {
		const favicon = faviconFallback(finalUrl);
		return favicon ? { url: finalUrl, favicon } : { url: finalUrl };
	}

	let body: string;
	try {
		const text = await res.text();
		body = text.length > UNFURL_MAX_BYTES ? text.slice(0, UNFURL_MAX_BYTES) : text;
	} catch {
		return null;
	}
	return extractMetadata(body, finalUrl);
}

/**
 * Fetches a url server-side and returns a link preview, or null when the url is unsafe or the
 * fetch fails. SSRF-guarded (see {@link isSafeUnfurlUrl}), 5s timeout, redirect-followed with a
 * post-redirect safety re-check, body capped at ~512KB. Results are cached in KV under
 * `smoke:unfurl:<sha256(url)>` for a day (shorter for thin/favicon-only previews); transient
 * failures (null) are never cached. Never throws.
 */
export async function fetchUnfurl(url: string, env: any): Promise<UnfurlPreview | null> {
	void env; // env kept for signature parity + future per-instance config
	if (!isSafeUnfurlUrl(url)) return null;

	try {
		const key = unfurlCacheKey(await sha256Hex(url));
		const cached = await readUnfurlCache(key);
		if (cached) return cached;

		const result = await performUnfurl(url);
		if (result) {
			const thin = !result.title && !result.description && !result.image;
			await writeUnfurlCache(key, result, thin ? UNFURL_THIN_TTL : UNFURL_CACHE_TTL);
		}
		return result;
	} catch {
		return null;
	}
}

// #endregion
