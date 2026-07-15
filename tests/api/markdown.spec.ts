import { describe, expect, it } from 'vitest';
import { _internal, renderMarkdown } from '~/utils/markdown';

describe('renderMarkdown', () => {
	it('renders bold and headings', () => {
		expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
		expect(renderMarkdown('_italic_')).toContain('<em>italic</em>');
		expect(renderMarkdown('# Title')).toMatch(/<h1[^>]*>Title<\/h1>/);
	});

	it('highlights fenced code blocks', () => {
		const out = renderMarkdown('```js\nconst x = 1\n```');
		expect(out).toContain('<pre>');
		expect(out).toContain('hljs');
		expect(out).toContain('language-js');
	});

	it('expands :emoji: shortcodes and leaves unknown ones untouched', () => {
		expect(renderMarkdown(':tada:')).toContain('🎉');
		expect(renderMarkdown('great work :+1:')).toContain('👍');
		expect(renderMarkdown(':definitely_not_an_emoji:')).toContain(':definitely_not_an_emoji:');
	});

	it('strips script tags from raw html', () => {
		const out = renderMarkdown('hello\n\n<script>alert(1)</script>');
		expect(out).not.toContain('<script');
		expect(out).not.toContain('alert(1)');
	});

	it('strips inline event handlers', () => {
		const out = renderMarkdown('<img src="x" onerror="alert(1)">');
		expect(out.toLowerCase()).not.toContain('onerror');
	});

	it('strips javascript: hrefs', () => {
		const out = renderMarkdown('[click](javascript:alert(1))');
		expect(out.toLowerCase()).not.toContain('javascript:');
	});

	it('keeps safe https links', () => {
		const out = renderMarkdown('[docs](https://example.com)');
		expect(out).toContain('href="https://example.com"');
	});

	it('returns an empty string for empty input', () => {
		expect(renderMarkdown('')).toBe('');
	});

	it('renders the ++underline++ extension', () => {
		expect(renderMarkdown('++underlined++')).toContain('<u>underlined</u>');
	});

	it('falls back to plaintext for an unknown fence language', () => {
		const out = renderMarkdown('```notareallang\ncode here\n```');
		expect(out).toContain('language-plaintext');
	});

	it('renders gfm tables', () => {
		const out = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |');
		expect(out).toContain('<table');
	});

	it('turns single newlines into line breaks', () => {
		expect(renderMarkdown('line one\nline two')).toContain('<br');
	});

	it('strips iframe blocks', () => {
		const out = renderMarkdown('before\n\n<iframe src="https://evil.example"></iframe>\n\nafter');
		expect(out.toLowerCase()).not.toContain('<iframe');
	});

	it('strips void form/meta elements', () => {
		const out = renderMarkdown('text <input type="text"> more');
		expect(out.toLowerCase()).not.toContain('<input');
	});

	it('strips inline style attributes', () => {
		const out = renderMarkdown('text <span style="color:red">red</span>');
		expect(out.toLowerCase()).not.toContain('style=');
	});

	it('strips data: urls from hrefs', () => {
		const out = renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD4=)');
		expect(out.toLowerCase()).not.toContain('data:');
	});

	it('expands multiple known emoji shortcodes', () => {
		const out = renderMarkdown(':fire: :rocket: :heart:');
		expect(out).toContain('🔥');
		expect(out).toContain('🚀');
		expect(out).toContain('❤️');
	});
});

// direct coverage of the branch-heavy pure helpers (the unit lane runs with
// import.meta.client === false, so renderMarkdown takes the regex server fallback)
describe('markdown sanitizer internals', () => {
	const { isRelativeUrl, isSafeUrl, expandEmojis, escapeHtml, sanitizeServerFallback } = _internal;

	describe('isRelativeUrl', () => {
		it('treats path/hash prefixes as relative', () => {
			expect(isRelativeUrl('/abs')).toBe(true);
			expect(isRelativeUrl('./rel')).toBe(true);
			expect(isRelativeUrl('../up')).toBe(true);
			expect(isRelativeUrl('#anchor')).toBe(true);
		});
		it('treats an absolute url as non-relative', () => {
			expect(isRelativeUrl('https://example.com')).toBe(false);
			expect(isRelativeUrl('mailto:a@b.com')).toBe(false);
		});
	});

	describe('isSafeUrl', () => {
		it('rejects empty values', () => {
			expect(isSafeUrl('', 'link')).toBe(false);
			expect(isSafeUrl('', 'media')).toBe(false);
		});
		it('allows any relative url', () => {
			expect(isSafeUrl('/foo', 'link')).toBe(true);
			expect(isSafeUrl('#top', 'media')).toBe(true);
		});
		it('allows http/https/mailto/tel for links', () => {
			expect(isSafeUrl('http://x.com', 'link')).toBe(true);
			expect(isSafeUrl('https://x.com', 'link')).toBe(true);
			expect(isSafeUrl('mailto:a@b.com', 'link')).toBe(true);
			expect(isSafeUrl('tel:+15551234567', 'link')).toBe(true);
		});
		it('rejects mailto/tel/javascript for media (only http/https)', () => {
			expect(isSafeUrl('http://x.com/a.png', 'media')).toBe(true);
			expect(isSafeUrl('https://x.com/a.png', 'media')).toBe(true);
			expect(isSafeUrl('mailto:a@b.com', 'media')).toBe(false);
			expect(isSafeUrl('tel:+1', 'media')).toBe(false);
		});
		it('rejects javascript: and data: schemes for links', () => {
			expect(isSafeUrl('javascript:alert(1)', 'link')).toBe(false);
			expect(isSafeUrl('data:text/html,x', 'link')).toBe(false);
		});
		it('returns false for an unparseable url', () => {
			expect(isSafeUrl('http://[bad', 'link')).toBe(false);
		});
	});

	describe('expandEmojis', () => {
		it('replaces known and leaves unknown', () => {
			expect(expandEmojis(':tada: :nope:')).toBe('🎉 :nope:');
		});
	});

	describe('escapeHtml', () => {
		it('escapes the html-significant characters', () => {
			expect(escapeHtml('<a href="x" & y>')).toBe('&lt;a href=&quot;x&quot; &amp; y&gt;');
		});
	});

	describe('sanitizeServerFallback', () => {
		it('removes paired dangerous blocks', () => {
			expect(sanitizeServerFallback('a<script>x</script>b')).toBe('ab');
			expect(sanitizeServerFallback('a<style>x</style>b')).toBe('ab');
			expect(sanitizeServerFallback('a<iframe>x</iframe>b')).toBe('ab');
			expect(sanitizeServerFallback('a<textarea>x</textarea>b')).toBe('ab');
		});
		it('removes void elements', () => {
			expect(sanitizeServerFallback('a<input type="x">b')).toBe('ab');
			expect(sanitizeServerFallback('a<meta charset="utf-8">b')).toBe('ab');
			expect(sanitizeServerFallback('a<link rel="x"/>b')).toBe('ab');
			expect(sanitizeServerFallback('a<base href="x">b')).toBe('ab');
		});
		it('strips on* handlers and style attributes', () => {
			expect(sanitizeServerFallback('<p onclick="x()">hi</p>').toLowerCase()).not.toContain(
				'onclick'
			);
			expect(sanitizeServerFallback('<p style="color:red">hi</p>').toLowerCase()).not.toContain(
				'style='
			);
		});
		it('strips javascript: and data: from quoted href/src', () => {
			expect(
				sanitizeServerFallback('<a href="javascript:alert(1)">x</a>').toLowerCase()
			).not.toContain('javascript:');
			expect(
				sanitizeServerFallback('<img src="data:image/png;base64,AA">').toLowerCase()
			).not.toContain('data:');
		});
		it('strips javascript: and data: from unquoted href/src', () => {
			expect(
				sanitizeServerFallback('<a href=javascript:alert(1)>x</a>').toLowerCase()
			).not.toContain('javascript:');
			expect(
				sanitizeServerFallback('<img src=data:image/png;base64,AA>').toLowerCase()
			).not.toContain('data:');
		});
		it('leaves benign markup intact', () => {
			const out = sanitizeServerFallback('<p class="x">hello <strong>world</strong></p>');
			expect(out).toContain('<strong>world</strong>');
			expect(out).toContain('class="x"');
		});
	});
});
