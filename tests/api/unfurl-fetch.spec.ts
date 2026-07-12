import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuntime } from './route-runtime';

function htmlResponse(body: string, contentType = 'text/html; charset=utf-8'): Response {
	return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('isSafeUnfurlUrl', () => {
	it('allows public http/https on the default ports', async () => {
		const { isSafeUnfurlUrl } = await import('#server-utils');
		expect(isSafeUnfurlUrl('https://example.com')).toBe(true);
		expect(isSafeUnfurlUrl('http://example.com')).toBe(true);
		expect(isSafeUnfurlUrl('http://example.com:80')).toBe(true);
		expect(isSafeUnfurlUrl('https://x.com:443')).toBe(true);
		expect(isSafeUnfurlUrl('https://sub.example.co.uk/path?q=1')).toBe(true);
	});

	it('rejects loopback + special-use hostnames', async () => {
		const { isSafeUnfurlUrl } = await import('#server-utils');
		expect(isSafeUnfurlUrl('http://localhost')).toBe(false);
		expect(isSafeUnfurlUrl('https://foo.internal')).toBe(false);
		expect(isSafeUnfurlUrl('https://box.local')).toBe(false);
		expect(isSafeUnfurlUrl('https://printer.lan')).toBe(false);
	});

	it('rejects private + reserved ipv4 literals', async () => {
		const { isSafeUnfurlUrl } = await import('#server-utils');
		expect(isSafeUnfurlUrl('http://127.0.0.1')).toBe(false);
		expect(isSafeUnfurlUrl('http://10.1.2.3')).toBe(false);
		expect(isSafeUnfurlUrl('http://192.168.1.1')).toBe(false);
		expect(isSafeUnfurlUrl('http://172.16.5.5')).toBe(false);
		expect(isSafeUnfurlUrl('http://169.254.169.254')).toBe(false); // cloud metadata ip
		expect(isSafeUnfurlUrl('http://0.0.0.0')).toBe(false);
		expect(isSafeUnfurlUrl('http://100.100.0.1')).toBe(false); // cgnat
		expect(isSafeUnfurlUrl('http://2130706433')).toBe(false); // obfuscated 127.0.0.1
	});

	it('rejects private ipv6 literals', async () => {
		const { isSafeUnfurlUrl } = await import('#server-utils');
		expect(isSafeUnfurlUrl('http://[::1]')).toBe(false);
		expect(isSafeUnfurlUrl('http://[::]')).toBe(false);
		expect(isSafeUnfurlUrl('http://[fc00::1]')).toBe(false);
		expect(isSafeUnfurlUrl('http://[fe80::1]')).toBe(false);
		expect(isSafeUnfurlUrl('http://[::ffff:169.254.169.254]')).toBe(false);
	});

	it('rejects non-http protocols and non-default ports', async () => {
		const { isSafeUnfurlUrl } = await import('#server-utils');
		expect(isSafeUnfurlUrl('ftp://example.com')).toBe(false);
		expect(isSafeUnfurlUrl('file:///etc/passwd')).toBe(false);
		expect(isSafeUnfurlUrl('http://example.com:8080')).toBe(false);
		expect(isSafeUnfurlUrl('gopher://example.com')).toBe(false);
	});

	it('rejects unparseable input', async () => {
		const { isSafeUnfurlUrl } = await import('#server-utils');
		expect(isSafeUnfurlUrl('not a url')).toBe(false);
		expect(isSafeUnfurlUrl('')).toBe(false);
		expect(isSafeUnfurlUrl('javascript:alert(1)')).toBe(false);
	});
});

describe('extractMetadata', () => {
	it('reads og tags regardless of attribute order', async () => {
		const { extractMetadata } = await import('#server-utils');
		const html = `
			<html><head>
			<meta property="og:title" content="Hello World">
			<meta content="A great page" name="og:description">
			<meta property="og:image" content="https://cdn.example.com/a.png">
			<meta property="og:site_name" content="Example Site">
			</head></html>`;
		const p = extractMetadata(html, 'https://example.com/post');
		expect(p.url).toBe('https://example.com/post');
		expect(p.title).toBe('Hello World');
		expect(p.description).toBe('A great page');
		expect(p.image).toBe('https://cdn.example.com/a.png');
		expect(p.siteName).toBe('Example Site');
	});

	it('falls back to twitter, then <title> + meta description', async () => {
		const { extractMetadata } = await import('#server-utils');
		const twitter = `
			<meta name="twitter:title" content="TW Title">
			<meta name="twitter:description" content="TW Desc">
			<meta name="twitter:image" content="https://cdn.example.com/tw.png">`;
		const tp = extractMetadata(twitter, 'https://example.com');
		expect(tp.title).toBe('TW Title');
		expect(tp.description).toBe('TW Desc');
		expect(tp.image).toBe('https://cdn.example.com/tw.png');

		const bare = `<html><head><title>Just A Title</title>
			<meta name="description" content="Plain description"></head></html>`;
		const bp = extractMetadata(bare, 'https://example.com');
		expect(bp.title).toBe('Just A Title');
		expect(bp.description).toBe('Plain description');
		// no image found -> field omitted
		expect(bp.image).toBeUndefined();
		// site name falls back to the hostname
		expect(bp.siteName).toBe('example.com');
	});

	it('reads schema.org from a ld+json @graph block', async () => {
		const { extractMetadata } = await import('#server-utils');
		const html = `<script type="application/ld+json">${JSON.stringify({
			'@context': 'https://schema.org',
			'@graph': [
				{ '@type': 'WebSite', url: 'https://example.com' },
				{
					'@type': 'Article',
					headline: 'Graph Headline',
					description: 'Graph description',
					image: ['https://cdn.example.com/g.png'],
					publisher: { '@type': 'Organization', name: 'Graph Publisher' }
				}
			]
		})}</script>`;
		const p = extractMetadata(html, 'https://example.com/a');
		expect(p.title).toBe('Graph Headline');
		expect(p.description).toBe('Graph description');
		expect(p.image).toBe('https://cdn.example.com/g.png');
		expect(p.siteName).toBe('Graph Publisher');
	});

	it('reads a ld+json image object and a top-level array', async () => {
		const { extractMetadata } = await import('#server-utils');
		const html = `<script type="application/ld+json">${JSON.stringify([
			{ '@type': 'Thing' },
			{ '@type': 'Article', name: 'Arr Name', image: { url: 'https://cdn.example.com/o.png' } }
		])}</script>`;
		const p = extractMetadata(html, 'https://example.com');
		expect(p.title).toBe('Arr Name');
		expect(p.image).toBe('https://cdn.example.com/o.png');
	});

	it('resolves relative image + favicon against the final url', async () => {
		const { extractMetadata } = await import('#server-utils');
		const html = `
			<meta property="og:image" content="/img/hero.png">
			<link rel="icon" href="/assets/favicon.png">`;
		const p = extractMetadata(html, 'https://example.com/blog/post');
		expect(p.image).toBe('https://example.com/img/hero.png');
		expect(p.favicon).toBe('https://example.com/assets/favicon.png');
	});

	it('falls back to /favicon.ico when no icon link is present', async () => {
		const { extractMetadata } = await import('#server-utils');
		const p = extractMetadata('<title>x</title>', 'https://example.com/deep/path');
		expect(p.favicon).toBe('https://example.com/favicon.ico');
	});

	it('prefers icon over apple-touch-icon', async () => {
		const { extractMetadata } = await import('#server-utils');
		const html = `
			<link rel="apple-touch-icon" href="https://example.com/apple.png">
			<link rel="shortcut icon" href="https://example.com/short.ico">`;
		const p = extractMetadata(html, 'https://example.com');
		expect(p.favicon).toBe('https://example.com/short.ico');
	});

	it('decodes html entities in extracted text', async () => {
		const { extractMetadata } = await import('#server-utils');
		const html = `<meta property="og:title" content="Ben &amp; Jerry&#39;s &lt;Best&gt; &#x2764;">`;
		const p = extractMetadata(html, 'https://example.com');
		expect(p.title).toBe("Ben & Jerry's <Best> ❤");
	});

	it('truncates an over-long title and description', async () => {
		const { extractMetadata } = await import('#server-utils');
		const html = `
			<meta property="og:title" content="${'T'.repeat(400)}">
			<meta property="og:description" content="${'D'.repeat(700)}">`;
		const p = extractMetadata(html, 'https://example.com');
		expect(p.title).toHaveLength(300);
		expect(p.description).toHaveLength(500);
	});

	it('never throws on garbage or malformed ld+json', async () => {
		const { extractMetadata } = await import('#server-utils');
		const garbage = '<<<>>> <meta <script type="application/ld+json">{ not json }</script>';
		expect(() => extractMetadata(garbage, 'https://example.com')).not.toThrow();
		const p = extractMetadata(garbage, 'https://example.com');
		expect(p.url).toBe('https://example.com');
		expect(p.favicon).toBe('https://example.com/favicon.ico');
	});
});

describe('fetchUnfurl', () => {
	const OG_HTML = `
		<html><head>
		<meta property="og:title" content="Fetched Title">
		<meta property="og:description" content="Fetched description">
		<meta property="og:image" content="https://cdn.example.com/img.png">
		<link rel="icon" href="https://example.com/favicon.ico">
		</head></html>`;

	it('parses a text/html response into a preview', async () => {
		const { fetchUnfurl } = await import('#server-utils');
		const fetchMock = vi.fn(async () => htmlResponse(OG_HTML));
		vi.stubGlobal('fetch', fetchMock);

		const preview = await fetchUnfurl('https://example.com/post', getRuntime().env);
		expect(preview).toMatchObject({
			url: 'https://example.com/post',
			title: 'Fetched Title',
			description: 'Fetched description',
			image: 'https://cdn.example.com/img.png',
			favicon: 'https://example.com/favicon.ico'
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(init.redirect).toBe('follow');
		expect((init.headers as Record<string, string>)['User-Agent']).toContain('Mozilla');
	});

	it('returns null for an unsafe url without touching the network', async () => {
		const { fetchUnfurl } = await import('#server-utils');
		const fetchMock = vi.fn(async () => htmlResponse(OG_HTML));
		vi.stubGlobal('fetch', fetchMock);

		expect(await fetchUnfurl('http://169.254.169.254/latest', getRuntime().env)).toBeNull();
		expect(await fetchUnfurl('http://localhost:8080', getRuntime().env)).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns a favicon-only thin preview for non-html content', async () => {
		const { fetchUnfurl } = await import('#server-utils');
		const fetchMock = vi.fn(async () => htmlResponse('{"a":1}', 'application/json'));
		vi.stubGlobal('fetch', fetchMock);

		const preview = await fetchUnfurl('https://example.com/data.json', getRuntime().env);
		expect(preview).toEqual({
			url: 'https://example.com/data.json',
			favicon: 'https://example.com/favicon.ico'
		});
	});

	it('returns null when the fetch throws or times out', async () => {
		const { fetchUnfurl } = await import('#server-utils');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		expect(await fetchUnfurl('https://example.com', getRuntime().env)).toBeNull();
	});

	it('serves a second identical request from the kv cache', async () => {
		const { fetchUnfurl } = await import('#server-utils');
		const fetchMock = vi.fn(async () => htmlResponse(OG_HTML));
		vi.stubGlobal('fetch', fetchMock);

		const first = await fetchUnfurl('https://example.com/cached', getRuntime().env);
		const second = await fetchUnfurl('https://example.com/cached', getRuntime().env);
		expect(second).toEqual(first);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
