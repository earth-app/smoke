import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '~/composables/useMarkdown';

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
