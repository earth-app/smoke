// edge-cached proxy for externally-hosted favicons; avoids a client redirect round trip,
// survives origin outages, and skips re-fetching the same asset on every cold request
const PROXY_CACHE_TTL = 60 * 60 * 24 * 7;
const PROXY_FETCH_TIMEOUT_MS = 5000;

// an iconify icon id looks like "prefix:name" (e.g. mdi:rocket-launch)
const ICONIFY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export function isIconifyId(value: string): boolean {
	return ICONIFY_RE.test(value.trim());
}

// build the iconify api svg url for an icon id, optionally tinted with the theme color
export function buildIconifyUrl(iconId: string, color?: string, size = 256): string {
	const [prefix, name] = iconId.trim().split(':');
	const params = new URLSearchParams({ height: String(size) });
	if (color && /^#([0-9a-f]{3}){1,2}$/i.test(color)) params.set('color', color);
	return `https://api.iconify.design/${prefix}/${name}.svg?${params.toString()}`;
}

export async function proxyExternalAsset(url: string, fallbackType: string): Promise<Response> {
	const cacheKey = new Request(url, { method: 'GET' });
	const edgeCache = (globalThis as any).caches?.default as Cache | undefined;

	if (edgeCache) {
		const hit = await edgeCache.match(cacheKey).catch(() => undefined);
		if (hit) return hit;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), PROXY_FETCH_TIMEOUT_MS);
	let upstream: Response;
	try {
		upstream = await fetch(url, { signal: controller.signal, redirect: 'follow' });
	} finally {
		clearTimeout(timer);
	}

	// don't cache failures; let the next request retry
	if (!upstream.ok) return new Response(null, { status: upstream.status });

	const headers = new Headers();
	headers.set('Content-Type', upstream.headers.get('Content-Type') ?? fallbackType);
	headers.set('Cache-Control', `public, max-age=${PROXY_CACHE_TTL}, immutable`);
	const body = await upstream.arrayBuffer();
	const response = new Response(body, { status: 200, headers });

	if (edgeCache) {
		try {
			await edgeCache.put(cacheKey, response.clone());
		} catch (error) {
			console.warn('favicon cache put failed:', error);
		}
	}

	return response;
}

// decode a "data:<mime>;base64,<payload>" favicon into raw bytes + mime, or null if not a data uri
export function decodeDataUri(value: string): { mimeType: string; bytes: Uint8Array } | null {
	const matches = value.match(/^data:([^;]+);base64,(.+)$/);
	if (!matches) return null;
	const binary = atob(matches[2]!);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return { mimeType: matches[1]!, bytes };
}
