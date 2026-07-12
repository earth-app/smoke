import hljs from 'highlight.js';
import { Marked } from 'marked';

// common github-style shortcodes; kept local so this module stays dom-free and ssr/worker safe
const EMOJI_SHORTCODES: Record<string, string> = {
	smile: '😄',
	smiley: '😃',
	grin: '😁',
	grinning: '😀',
	laughing: '😆',
	sweat_smile: '😅',
	joy: '😂',
	rofl: '🤣',
	wink: '😉',
	blush: '😊',
	slightly_smiling_face: '🙂',
	heart: '❤️',
	heart_eyes: '😍',
	kissing_heart: '😘',
	thinking: '🤔',
	neutral_face: '😐',
	confused: '😕',
	worried: '😟',
	cry: '😢',
	sob: '😭',
	angry: '😠',
	rage: '😡',
	sunglasses: '😎',
	sleeping: '😴',
	dizzy_face: '😵',
	tada: '🎉',
	confetti_ball: '🎊',
	rocket: '🚀',
	fire: '🔥',
	sparkles: '✨',
	star: '⭐',
	star2: '🌟',
	zap: '⚡',
	boom: '💥',
	'100': '💯',
	'+1': '👍',
	thumbsup: '👍',
	'-1': '👎',
	thumbsdown: '👎',
	ok_hand: '👌',
	wave: '👋',
	clap: '👏',
	pray: '🙏',
	raised_hands: '🙌',
	muscle: '💪',
	eyes: '👀',
	point_right: '👉',
	point_left: '👈',
	point_up: '👆',
	point_down: '👇',
	check: '✔️',
	white_check_mark: '✅',
	heavy_check_mark: '✔️',
	x: '❌',
	warning: '⚠️',
	no_entry: '⛔',
	question: '❓',
	exclamation: '❗',
	bug: '🐛',
	bell: '🔔',
	email: '📧',
	envelope: '✉️',
	inbox_tray: '📥',
	outbox_tray: '📤',
	memo: '📝',
	pencil: '✏️',
	bulb: '💡',
	lock: '🔒',
	unlock: '🔓',
	key: '🔑',
	hourglass: '⌛',
	clock: '🕐',
	calendar: '📅',
	hammer: '🔨',
	wrench: '🔧',
	gear: '⚙️',
	package: '📦',
	books: '📚',
	mag: '🔍',
	link: '🔗',
	pushpin: '📌',
	speech_balloon: '💬',
	tag: '🏷️',
	chart_with_upwards_trend: '📈',
	chart_with_downwards_trend: '📉'
};

// expand :shortcode: to unicode; leaves unknown codes untouched
function expandEmojis(content: string): string {
	return content.replace(
		/:([a-zA-Z0-9_+-]+):/g,
		(match, code: string) => EMOJI_SHORTCODES[code] ?? match
	);
}

// support ++underline++ syntax (ported from nuxtpress)
const underlineExtension = {
	name: 'underline',
	level: 'inline' as const,
	start(src: string) {
		return src.match(/\+\+/)?.index;
	},
	tokenizer(src: string) {
		const rule = /^\+\+([^+]+)\+\+/;
		const match = rule.exec(src);
		if (match) {
			return { type: 'underline', raw: match[0], text: match[1] };
		}
	},
	renderer(token: { text: string }) {
		return `<u>${token.text}</u>`;
	}
};

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// one configured instance; avoids re-registering extensions on every render
const md = new Marked({ gfm: true, breaks: true });
md.use({ extensions: [underlineExtension] });
md.use({
	renderer: {
		code({ text, lang }: { text: string; lang?: string }) {
			const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
			try {
				const highlighted = hljs.highlight(text, { language }).value;
				return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
			} catch {
				return `<pre><code class="hljs">${escapeHtml(text)}</code></pre>`;
			}
		}
	}
});

// #region sanitizer (dependency-free allowlist; ported from nuxtpress)
const ALLOWED_TAG_NAMES = new Set([
	'p',
	'br',
	'hr',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'ul',
	'ol',
	'li',
	'blockquote',
	'pre',
	'code',
	'em',
	'strong',
	'del',
	'u',
	'a',
	'img',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
	'span'
]);

const ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
	'*': new Set(['class', 'title']),
	a: new Set(['href', 'target', 'rel']),
	img: new Set(['src', 'alt', 'loading', 'decoding']),
	code: new Set(['class']),
	span: new Set(['class'])
};

function isRelativeUrl(value: string): boolean {
	return (
		value.startsWith('/') ||
		value.startsWith('./') ||
		value.startsWith('../') ||
		value.startsWith('#')
	);
}

function isSafeUrl(value: string, type: 'link' | 'media'): boolean {
	if (!value) return false;
	if (isRelativeUrl(value)) return true;

	try {
		const url = new URL(value);
		const protocol = url.protocol.toLowerCase();
		if (type === 'link') {
			return (
				protocol === 'http:' ||
				protocol === 'https:' ||
				protocol === 'mailto:' ||
				protocol === 'tel:'
			);
		}
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

// regex fallback for ssr / worker isolates where DOMParser is unavailable
function sanitizeServerFallback(html: string): string {
	return html
		.replace(
			/<\s*(script|style|iframe|object|embed|form|button|textarea|select|option)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
			''
		)
		.replace(/<\s*(input|meta|link|base)\b[^>]*\/?>/gi, '')
		.replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
		.replace(/\sstyle\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
		.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '')
		.replace(/\s(href|src)\s*=\s*(['"])\s*data:[\s\S]*?\2/gi, '')
		.replace(/\s(href|src)\s*=\s*javascript:[^\s>]*/gi, '')
		.replace(/\s(href|src)\s*=\s*data:[^\s>]*/gi, '');
}

function sanitizeHtml(html: string): string {
	if (!html) return '';

	if (
		import.meta.client &&
		typeof window !== 'undefined' &&
		typeof window.DOMParser !== 'undefined'
	) {
		const parser = new window.DOMParser();
		const doc = parser.parseFromString(html, 'text/html');

		doc
			.querySelectorAll(
				'script,style,iframe,object,embed,form,input,button,textarea,select,option,meta,link,base'
			)
			.forEach((node) => node.remove());

		for (const node of Array.from(doc.body.querySelectorAll('*'))) {
			const tagName = node.tagName.toLowerCase();

			if (!ALLOWED_TAG_NAMES.has(tagName)) {
				node.replaceWith(...Array.from(node.childNodes));
				continue;
			}

			for (const attr of Array.from(node.attributes)) {
				const attrName = attr.name.toLowerCase();
				const attrValue = attr.value.trim();
				const allowedForTag = ALLOWED_ATTRS[tagName];
				const isAllowed = ALLOWED_ATTRS['*']?.has(attrName) || allowedForTag?.has(attrName);

				if (!isAllowed || attrName.startsWith('on')) {
					node.removeAttribute(attr.name);
					continue;
				}

				if (attrName === 'href' && !isSafeUrl(attrValue, 'link')) {
					node.removeAttribute(attr.name);
					continue;
				}

				if (attrName === 'src' && !isSafeUrl(attrValue, 'media')) {
					node.removeAttribute(attr.name);
				}
			}

			if (tagName === 'a') {
				const href = node.getAttribute('href') || '';
				if (href.startsWith('http://') || href.startsWith('https://')) {
					node.setAttribute('target', '_blank');
					node.setAttribute('rel', 'noopener noreferrer nofollow');
				} else {
					node.removeAttribute('target');
					node.removeAttribute('rel');
				}
			}

			if (tagName === 'img') {
				if (!node.getAttribute('loading')) node.setAttribute('loading', 'lazy');
				node.setAttribute('decoding', 'async');
			}
		}

		return doc.body.innerHTML;
	}

	return sanitizeServerFallback(html);
}
// #endregion

/**
 * Renders user-supplied markdown to sanitized HTML.
 *
 * Uses `marked` (gfm + line breaks) with `highlight.js` for code fences, expands `:emoji:`
 * shortcodes, then runs the output through a dependency-free allowlist sanitizer (DOMParser on
 * the client, regex fallback on the server / worker). Safe to `v-html`.
 *
 * @example
 * const html = renderMarkdown('**hi** :tada:')
 */
export function renderMarkdown(content: string): string {
	if (!content) return '';
	try {
		const html = md.parse(expandEmojis(content), { async: false }) as string;
		return sanitizeHtml(typeof html === 'string' ? html : '');
	} catch {
		return escapeHtml(content);
	}
}

export function useMarkdown() {
	return { renderMarkdown };
}
