export type LinkKind =
	'google-doc' | 'github-issue' | 'github-pr' | 'github-repo' | 'github-gist' | 'generic';

export type LinkProvider = 'github' | 'google' | 'generic';

export type ClassifiedLink = {
	url: string;
	kind: LinkKind;
	provider: LinkProvider;
	host: string;
	// short display label (e.g. owner/repo#12, Google Doc)
	label: string;
	// longer human title for tooltips / aria
	title: string;
	owner?: string;
	repo?: string;
	number?: number;
	docId?: string;
	gistId?: string;
};

const URL_RE = /https?:\/\/[^\s<>"'`\]]+/gi;

/**
 * Extracts http(s) links from plain text or markdown, de-duplicated in first-seen order.
 *
 * Trailing sentence punctuation and an unbalanced closing paren (from `[text](url)`) are trimmed.
 *
 * @example
 * detectLinks('see https://example.com and https://example.com.') // ['https://example.com']
 */
export function detectLinks(text: string): string[] {
	if (!text) return [];

	const out: string[] = [];
	const seen = new Set<string>();

	for (const match of text.matchAll(URL_RE)) {
		let url = match[0].replace(/[.,;:!?]+$/, '');
		// drop a dangling ) left over from a markdown link when the url has no opening (
		if (url.endsWith(')') && !url.includes('(')) url = url.slice(0, -1);
		if (!url || seen.has(url)) continue;
		seen.add(url);
		out.push(url);
	}

	return out;
}

/**
 * Classifies a url into a known provider shape using only its structure - no network, no api keys.
 *
 * Recognizes Google Docs, GitHub issues / pull requests / repos / gists; everything else is
 * `generic`. Derives a display `label` and `title` from the parsed url alone.
 *
 * @example
 * classifyLink('https://github.com/owner/repo/issues/12').label // 'owner/repo#12'
 */
export function classifyLink(url: string): ClassifiedLink {
	let parsed: URL | null = null;
	try {
		parsed = new URL(url);
	} catch {
		parsed = null;
	}

	if (!parsed) {
		return { url, kind: 'generic', provider: 'generic', host: '', label: url, title: url };
	}

	const host = parsed.hostname.replace(/^www\./, '');
	const segs = parsed.pathname.split('/').filter(Boolean);

	if (host === 'docs.google.com') {
		const docId = segs[0] === 'document' && segs[1] === 'd' ? segs[2] : undefined;
		if (docId) {
			return {
				url,
				kind: 'google-doc',
				provider: 'google',
				host,
				docId,
				label: 'Google Doc',
				title: 'Google Doc'
			};
		}
	}

	if (host === 'gist.github.com') {
		const owner = segs.length >= 2 ? segs[0] : undefined;
		const gistId = segs.length >= 2 ? segs[1] : segs[0];
		return {
			url,
			kind: 'github-gist',
			provider: 'github',
			host,
			owner,
			gistId,
			label: owner ? `${owner}/${gistId}` : gistId || 'Gist',
			title: 'GitHub Gist'
		};
	}

	if (host === 'github.com') {
		const owner = segs[0];
		const repo = segs[1];

		if (owner && repo && (segs[2] === 'issues' || segs[2] === 'pull')) {
			const number = Number(segs[3]);
			if (Number.isInteger(number) && number > 0) {
				const isPr = segs[2] === 'pull';
				return {
					url,
					kind: isPr ? 'github-pr' : 'github-issue',
					provider: 'github',
					host,
					owner,
					repo,
					number,
					label: `${owner}/${repo}#${number}`,
					title: `${owner}/${repo} ${isPr ? 'pull request' : 'issue'} #${number}`
				};
			}
		}

		if (owner && repo) {
			return {
				url,
				kind: 'github-repo',
				provider: 'github',
				host,
				owner,
				repo,
				label: `${owner}/${repo}`,
				title: `${owner}/${repo}`
			};
		}
	}

	return {
		url,
		kind: 'generic',
		provider: 'generic',
		host,
		label: host || url,
		title: host || url
	};
}
