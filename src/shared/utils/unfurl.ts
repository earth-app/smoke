export type LinkKind =
	| 'google-doc'
	| 'github-issue'
	| 'github-pr'
	| 'github-repo'
	| 'github-gist'
	| 'gitlab-issue'
	| 'gitlab-mr'
	| 'gitlab-repo'
	| 'bitbucket-issue'
	| 'bitbucket-pr'
	| 'bitbucket-repo'
	| 'stackoverflow'
	| 'jira'
	| 'discord'
	| 'instagram'
	| 'youtube'
	| 'docker'
	| 'spotify'
	| 'wikipedia'
	| 'generic';

export type LinkProvider =
	| 'github'
	| 'google'
	| 'gitlab'
	| 'bitbucket'
	| 'stackoverflow'
	| 'jira'
	| 'discord'
	| 'instagram'
	| 'youtube'
	| 'docker'
	| 'spotify'
	| 'wikipedia'
	| 'generic';

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
	// generic resource id (video id, track id, question id, invite code, article, image name)
	id?: string;
	// provider sub-type (spotify track/album, instagram post/reel, discord invite/channel)
	resource?: string;
	// jira issue key (e.g. PROJ-123)
	issueKey?: string;
};

export type UnfurlPreview = {
	url: string;
	title?: string;
	description?: string;
	image?: string;
	favicon?: string;
	siteName?: string;
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
 * Recognizes Google Docs; GitHub / GitLab / Bitbucket issues, pull/merge requests and repos;
 * GitHub gists; Stack Overflow, Jira, Discord, Instagram, YouTube, Docker Hub, Spotify and
 * Wikipedia. Everything else is `generic`. Derives a display `label` and `title` from the url
 * alone.
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

	// gitlab mirrors github; the "-" segment separates the repo path from the resource
	if (host === 'gitlab.com') {
		const owner = segs[0];
		const repo = segs[1];
		const dash = segs.indexOf('-');

		if (owner && repo && dash !== -1) {
			const kindSeg = segs[dash + 1];
			const number = Number(segs[dash + 2]);
			if (
				(kindSeg === 'issues' || kindSeg === 'merge_requests') &&
				Number.isInteger(number) &&
				number > 0
			) {
				const isMr = kindSeg === 'merge_requests';
				return {
					url,
					kind: isMr ? 'gitlab-mr' : 'gitlab-issue',
					provider: 'gitlab',
					host,
					owner,
					repo,
					number,
					label: `${owner}/${repo}#${number}`,
					title: `${owner}/${repo} ${isMr ? 'merge request' : 'issue'} #${number}`
				};
			}
		}

		if (owner && repo) {
			return {
				url,
				kind: 'gitlab-repo',
				provider: 'gitlab',
				host,
				owner,
				repo,
				label: `${owner}/${repo}`,
				title: `${owner}/${repo}`
			};
		}
	}

	if (host === 'bitbucket.org') {
		const owner = segs[0];
		const repo = segs[1];

		if (owner && repo && (segs[2] === 'issues' || segs[2] === 'pull-requests')) {
			const number = Number(segs[3]);
			if (Number.isInteger(number) && number > 0) {
				const isPr = segs[2] === 'pull-requests';
				return {
					url,
					kind: isPr ? 'bitbucket-pr' : 'bitbucket-issue',
					provider: 'bitbucket',
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
				kind: 'bitbucket-repo',
				provider: 'bitbucket',
				host,
				owner,
				repo,
				label: `${owner}/${repo}`,
				title: `${owner}/${repo}`
			};
		}
	}

	// stackoverflow question / short-question / answer permalinks all carry the id at segs[1]
	if (host === 'stackoverflow.com') {
		if (segs[0] === 'questions' || segs[0] === 'q' || segs[0] === 'a') {
			const id = segs[1];
			if (id && /^\d+$/.test(id)) {
				return {
					url,
					kind: 'stackoverflow',
					provider: 'stackoverflow',
					host,
					id,
					label: `#${id}`,
					title: `Stack Overflow Question #${id}`
				};
			}
		}
	}

	if (/\.atlassian\.net$/.test(host)) {
		if (segs[0] === 'browse' && segs[1] && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(segs[1])) {
			const issueKey = segs[1];
			return {
				url,
				kind: 'jira',
				provider: 'jira',
				host,
				issueKey,
				label: issueKey,
				title: `Jira Issue ${issueKey}`
			};
		}
	}

	if (host === 'discord.gg') {
		const code = segs[0];
		if (code) {
			return {
				url,
				kind: 'discord',
				provider: 'discord',
				host,
				resource: 'invite',
				id: code,
				label: 'Discord Invite',
				title: 'Discord Invite'
			};
		}
	}
	if (host === 'discord.com' || host === 'discordapp.com') {
		if (segs[0] === 'invite' && segs[1]) {
			return {
				url,
				kind: 'discord',
				provider: 'discord',
				host,
				resource: 'invite',
				id: segs[1],
				label: 'Discord Invite',
				title: 'Discord Invite'
			};
		}
		if (segs[0] === 'channels') {
			return {
				url,
				kind: 'discord',
				provider: 'discord',
				host,
				resource: 'channel',
				label: 'Discord',
				title: 'Discord'
			};
		}
	}

	if (host === 'instagram.com') {
		const first = segs[0];
		if ((first === 'p' || first === 'reel' || first === 'tv') && segs[1]) {
			const resource = first === 'p' ? 'post' : first;
			const nice = resource === 'post' ? 'Post' : resource === 'reel' ? 'Reel' : 'TV';
			return {
				url,
				kind: 'instagram',
				provider: 'instagram',
				host,
				resource,
				id: segs[1],
				label: `Instagram ${nice}`,
				title: `Instagram ${nice}`
			};
		}
		if (first) {
			return {
				url,
				kind: 'instagram',
				provider: 'instagram',
				host,
				resource: 'profile',
				id: first,
				label: `@${first}`,
				title: `@${first} on Instagram`
			};
		}
	}

	if (host === 'youtu.be') {
		const id = segs[0];
		if (id) {
			return {
				url,
				kind: 'youtube',
				provider: 'youtube',
				host,
				resource: 'video',
				id,
				label: 'YouTube Video',
				title: 'YouTube Video'
			};
		}
	}
	if (host === 'youtube.com') {
		let videoId: string | undefined;
		if (segs[0] === 'watch') videoId = parsed.searchParams.get('v') || undefined;
		else if (segs[0] === 'shorts' && segs[1]) videoId = segs[1];
		else if (segs[0] === 'embed' && segs[1]) videoId = segs[1];

		if (videoId) {
			return {
				url,
				kind: 'youtube',
				provider: 'youtube',
				host,
				resource: 'video',
				id: videoId,
				label: 'YouTube Video',
				title: 'YouTube Video'
			};
		}

		// channels come as @handle, /channel/<id> or /c/<name>
		let channel: string | undefined;
		if (segs[0]?.startsWith('@')) channel = segs[0];
		else if (segs[0] === 'channel' && segs[1]) channel = segs[1];
		else if (segs[0] === 'c' && segs[1]) channel = segs[1];

		if (channel) {
			return {
				url,
				kind: 'youtube',
				provider: 'youtube',
				host,
				resource: 'channel',
				id: channel,
				label: channel,
				title: `YouTube Channel ${channel}`
			};
		}
	}

	if (host === 'hub.docker.com') {
		if (segs[0] === 'r' && segs[1] && segs[2]) {
			const owner = segs[1];
			const repo = segs[2];
			return {
				url,
				kind: 'docker',
				provider: 'docker',
				host,
				owner,
				repo,
				label: `${owner}/${repo}`,
				title: `Docker Image ${owner}/${repo}`
			};
		}
		const official = segs[0] === '_' ? segs[1] : undefined;
		if (official) {
			return {
				url,
				kind: 'docker',
				provider: 'docker',
				host,
				id: official,
				label: official,
				title: `Docker Image ${official}`
			};
		}
	}

	if (host === 'open.spotify.com') {
		const type = segs[0];
		const types = ['track', 'album', 'playlist', 'artist', 'show', 'episode'];
		if (type && types.includes(type) && segs[1]) {
			const nice = type.charAt(0).toUpperCase() + type.slice(1);
			return {
				url,
				kind: 'spotify',
				provider: 'spotify',
				host,
				resource: type,
				id: segs[1],
				label: `Spotify ${nice}`,
				title: `Spotify ${nice}`
			};
		}
	}

	// any-language subdomain, e.g. en / fr / zh-yue .wikipedia.org
	if (/(^|\.)wikipedia\.org$/.test(host)) {
		if (segs[0] === 'wiki' && segs[1]) {
			const article = safeDecode(segs.slice(1).join('/'));
			const label = article.replace(/_/g, ' ');
			return {
				url,
				kind: 'wikipedia',
				provider: 'wikipedia',
				host,
				id: article,
				label,
				title: `Wikipedia: ${label}`
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

/**
 * Returns a CORS-enabled public api url to hydrate a link CLIENT-SIDE, or null when none exists
 * (the caller then falls back to the server `/api/unfurl` route). Pure url construction - no fetch.
 *
 * @example
 * clientUnfurlEndpoint(classifyLink('https://youtu.be/dQw4w9WgXcQ'))
 * // 'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ'
 */
export function clientUnfurlEndpoint(link: ClassifiedLink): string | null {
	if (link.kind === 'youtube' && link.resource === 'video') {
		return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(link.url)}`;
	}
	if (link.kind === 'spotify') {
		return `https://open.spotify.com/oembed?url=${encodeURIComponent(link.url)}`;
	}
	if (link.kind === 'wikipedia' && link.id) {
		const lang = wikipediaLang(link.host);
		return `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(link.id)}`;
	}
	if (link.kind === 'stackoverflow' && link.id) {
		return `https://api.stackexchange.com/2.3/questions/${link.id}?site=stackoverflow&filter=default`;
	}
	return null;
}

/**
 * Normalizes a provider's client-api json into an `UnfurlPreview`. Pure + total: guards missing
 * fields, never throws, and always stamps `url`. Returns just `{ url }` when `raw` is empty.
 *
 * @example
 * normalizeClientUnfurl(link, { title: 'Video', thumbnail_url: 'x', provider_name: 'YouTube' })
 * // { url, title: 'Video', image: 'x', siteName: 'YouTube' }
 */
export function normalizeClientUnfurl(link: ClassifiedLink, raw: any): UnfurlPreview {
	const base: UnfurlPreview = { url: link.url };
	if (!raw || typeof raw !== 'object') return base;

	// youtube + spotify both speak oembed
	if (link.kind === 'youtube' || link.kind === 'spotify') {
		return {
			url: link.url,
			title: raw.title || undefined,
			image: raw.thumbnail_url || undefined,
			siteName: raw.provider_name || undefined
		};
	}

	if (link.kind === 'wikipedia') {
		return {
			url: link.url,
			title: raw.title || undefined,
			description: raw.extract || undefined,
			image: raw.thumbnail?.source || undefined
		};
	}

	if (link.kind === 'stackoverflow') {
		const item = raw.items?.[0];
		return {
			url: link.url,
			title: item?.title ? decodeEntities(item.title) : undefined
		};
	}

	return base;
}

function safeDecode(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

// language subdomain of a wikipedia host; defaults to en when bare (wikipedia.org)
function wikipediaLang(host: string): string {
	const m = /^([a-z-]+)\.wikipedia\.org$/i.exec(host);
	return m?.[1] ?? 'en';
}

// minimal html-entity decode for the handful the stackexchange api emits
function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"');
}
