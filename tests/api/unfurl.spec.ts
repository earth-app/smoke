import { describe, expect, it } from 'vitest';
import {
	classifyLink,
	clientUnfurlEndpoint,
	detectLinks,
	normalizeClientUnfurl
} from '~/shared/utils/unfurl';

describe('detectLinks', () => {
	it('extracts unique http(s) links in first-seen order', () => {
		const text = 'see https://a.com and http://b.org then https://a.com again';
		expect(detectLinks(text)).toEqual(['https://a.com', 'http://b.org']);
	});

	it('trims trailing punctuation', () => {
		expect(detectLinks('go to https://example.com.')).toEqual(['https://example.com']);
		expect(detectLinks('here: https://example.com/x?y=1!')).toEqual(['https://example.com/x?y=1']);
	});

	it('trims a dangling markdown paren', () => {
		expect(detectLinks('[docs](https://example.com/docs)')).toEqual(['https://example.com/docs']);
	});

	it('returns empty for text without links', () => {
		expect(detectLinks('no links here')).toEqual([]);
		expect(detectLinks('')).toEqual([]);
	});
});

describe('classifyLink', () => {
	it('classifies a github issue', () => {
		const r = classifyLink('https://github.com/earth-app/smoke/issues/42');
		expect(r.kind).toBe('github-issue');
		expect(r.provider).toBe('github');
		expect(r.owner).toBe('earth-app');
		expect(r.repo).toBe('smoke');
		expect(r.number).toBe(42);
		expect(r.label).toBe('earth-app/smoke#42');
	});

	it('classifies a github pull request', () => {
		const r = classifyLink('https://github.com/earth-app/smoke/pull/7');
		expect(r.kind).toBe('github-pr');
		expect(r.number).toBe(7);
		expect(r.label).toBe('earth-app/smoke#7');
	});

	it('classifies a github repo', () => {
		const r = classifyLink('https://github.com/earth-app/smoke');
		expect(r.kind).toBe('github-repo');
		expect(r.owner).toBe('earth-app');
		expect(r.repo).toBe('smoke');
		expect(r.label).toBe('earth-app/smoke');
	});

	it('classifies a github gist', () => {
		const r = classifyLink('https://gist.github.com/octocat/aa5a315d61ae9438b18d');
		expect(r.kind).toBe('github-gist');
		expect(r.provider).toBe('github');
		expect(r.owner).toBe('octocat');
		expect(r.gistId).toBe('aa5a315d61ae9438b18d');
	});

	it('classifies a google doc', () => {
		const r = classifyLink('https://docs.google.com/document/d/abc123XYZ/edit');
		expect(r.kind).toBe('google-doc');
		expect(r.provider).toBe('google');
		expect(r.docId).toBe('abc123XYZ');
		expect(r.label).toBe('Google Doc');
	});

	it('falls back to generic and strips www from the host', () => {
		const generic = classifyLink('https://example.com/some/path');
		expect(generic.kind).toBe('generic');
		expect(generic.provider).toBe('generic');
		expect(generic.host).toBe('example.com');

		expect(classifyLink('https://www.example.com').host).toBe('example.com');
	});

	it('treats a github repo path with a non-numeric issue segment as a repo', () => {
		const r = classifyLink('https://github.com/earth-app/smoke/issues/new');
		expect(r.kind).toBe('github-repo');
	});

	it('handles unparseable input', () => {
		const r = classifyLink('not a url');
		expect(r.kind).toBe('generic');
		expect(r.provider).toBe('generic');
	});

	// gitlab

	it('classifies a gitlab issue', () => {
		const r = classifyLink('https://gitlab.com/gitlab-org/gitlab/-/issues/5');
		expect(r.kind).toBe('gitlab-issue');
		expect(r.provider).toBe('gitlab');
		expect(r.owner).toBe('gitlab-org');
		expect(r.repo).toBe('gitlab');
		expect(r.number).toBe(5);
		expect(r.label).toBe('gitlab-org/gitlab#5');
	});

	it('classifies a gitlab merge request', () => {
		const r = classifyLink('https://gitlab.com/gitlab-org/gitlab/-/merge_requests/900');
		expect(r.kind).toBe('gitlab-mr');
		expect(r.provider).toBe('gitlab');
		expect(r.number).toBe(900);
		expect(r.label).toBe('gitlab-org/gitlab#900');
	});

	it('classifies a gitlab repo', () => {
		const r = classifyLink('https://gitlab.com/gitlab-org/gitlab');
		expect(r.kind).toBe('gitlab-repo');
		expect(r.owner).toBe('gitlab-org');
		expect(r.repo).toBe('gitlab');
		expect(r.label).toBe('gitlab-org/gitlab');
	});

	it('treats a gitlab tree path as a repo', () => {
		const r = classifyLink('https://gitlab.com/gitlab-org/gitlab/-/tree/master');
		expect(r.kind).toBe('gitlab-repo');
		expect(r.label).toBe('gitlab-org/gitlab');
	});

	// bitbucket

	it('classifies a bitbucket issue', () => {
		const r = classifyLink('https://bitbucket.org/atlassian/aui/issues/12');
		expect(r.kind).toBe('bitbucket-issue');
		expect(r.provider).toBe('bitbucket');
		expect(r.owner).toBe('atlassian');
		expect(r.repo).toBe('aui');
		expect(r.number).toBe(12);
		expect(r.label).toBe('atlassian/aui#12');
	});

	it('classifies a bitbucket pull request', () => {
		const r = classifyLink('https://bitbucket.org/atlassian/aui/pull-requests/34');
		expect(r.kind).toBe('bitbucket-pr');
		expect(r.provider).toBe('bitbucket');
		expect(r.number).toBe(34);
		expect(r.label).toBe('atlassian/aui#34');
	});

	it('classifies a bitbucket repo', () => {
		const r = classifyLink('https://bitbucket.org/atlassian/aui');
		expect(r.kind).toBe('bitbucket-repo');
		expect(r.owner).toBe('atlassian');
		expect(r.repo).toBe('aui');
		expect(r.label).toBe('atlassian/aui');
	});

	// stackoverflow

	it('classifies a stackoverflow question', () => {
		const r = classifyLink(
			'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster'
		);
		expect(r.kind).toBe('stackoverflow');
		expect(r.provider).toBe('stackoverflow');
		expect(r.id).toBe('11227809');
		expect(r.label).toBe('#11227809');
		expect(r.title).toBe('Stack Overflow Question #11227809');
	});

	it('classifies a stackoverflow short question link', () => {
		const r = classifyLink('https://stackoverflow.com/q/231767');
		expect(r.kind).toBe('stackoverflow');
		expect(r.id).toBe('231767');
	});

	it('classifies a stackoverflow answer link', () => {
		const r = classifyLink('https://stackoverflow.com/a/231855/12345');
		expect(r.kind).toBe('stackoverflow');
		expect(r.id).toBe('231855');
	});

	// jira

	it('classifies a jira issue', () => {
		const r = classifyLink('https://mycompany.atlassian.net/browse/PROJ-123');
		expect(r.kind).toBe('jira');
		expect(r.provider).toBe('jira');
		expect(r.issueKey).toBe('PROJ-123');
		expect(r.label).toBe('PROJ-123');
		expect(r.title).toBe('Jira Issue PROJ-123');
	});

	// discord

	it('classifies a discord.gg invite', () => {
		const r = classifyLink('https://discord.gg/abc123');
		expect(r.kind).toBe('discord');
		expect(r.provider).toBe('discord');
		expect(r.resource).toBe('invite');
		expect(r.id).toBe('abc123');
		expect(r.label).toBe('Discord Invite');
	});

	it('classifies a discord.com invite', () => {
		const r = classifyLink('https://discord.com/invite/xyz789');
		expect(r.kind).toBe('discord');
		expect(r.resource).toBe('invite');
		expect(r.id).toBe('xyz789');
	});

	it('classifies a discord channel link', () => {
		const r = classifyLink('https://discord.com/channels/123456/7891011');
		expect(r.kind).toBe('discord');
		expect(r.resource).toBe('channel');
		expect(r.label).toBe('Discord');
	});

	// instagram

	it('classifies an instagram post', () => {
		const r = classifyLink('https://instagram.com/p/CpYzXaBcDeF/');
		expect(r.kind).toBe('instagram');
		expect(r.provider).toBe('instagram');
		expect(r.resource).toBe('post');
		expect(r.id).toBe('CpYzXaBcDeF');
		expect(r.label).toBe('Instagram Post');
	});

	it('classifies an instagram reel', () => {
		const r = classifyLink('https://instagram.com/reel/AbCdEf/');
		expect(r.resource).toBe('reel');
		expect(r.label).toBe('Instagram Reel');
	});

	it('classifies an instagram tv', () => {
		const r = classifyLink('https://instagram.com/tv/GhIjKl/');
		expect(r.resource).toBe('tv');
		expect(r.label).toBe('Instagram TV');
	});

	it('classifies an instagram profile', () => {
		const r = classifyLink('https://instagram.com/nasa');
		expect(r.kind).toBe('instagram');
		expect(r.resource).toBe('profile');
		expect(r.id).toBe('nasa');
		expect(r.label).toBe('@nasa');
	});

	// youtube

	it('classifies a youtube watch url', () => {
		const r = classifyLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
		expect(r.kind).toBe('youtube');
		expect(r.provider).toBe('youtube');
		expect(r.resource).toBe('video');
		expect(r.id).toBe('dQw4w9WgXcQ');
		expect(r.label).toBe('YouTube Video');
	});

	it('classifies a youtu.be short url', () => {
		const r = classifyLink('https://youtu.be/dQw4w9WgXcQ');
		expect(r.resource).toBe('video');
		expect(r.id).toBe('dQw4w9WgXcQ');
	});

	it('classifies a youtube shorts url', () => {
		const r = classifyLink('https://www.youtube.com/shorts/abc123');
		expect(r.resource).toBe('video');
		expect(r.id).toBe('abc123');
	});

	it('classifies a youtube embed url', () => {
		const r = classifyLink('https://www.youtube.com/embed/xyz789');
		expect(r.resource).toBe('video');
		expect(r.id).toBe('xyz789');
	});

	it('classifies a youtube @handle channel', () => {
		const r = classifyLink('https://www.youtube.com/@veritasium');
		expect(r.resource).toBe('channel');
		expect(r.id).toBe('@veritasium');
		expect(r.label).toBe('@veritasium');
	});

	it('classifies a youtube /channel/ id', () => {
		const r = classifyLink('https://www.youtube.com/channel/UCabc123');
		expect(r.resource).toBe('channel');
		expect(r.id).toBe('UCabc123');
	});

	it('classifies a youtube /c/ vanity channel', () => {
		const r = classifyLink('https://www.youtube.com/c/SomeName');
		expect(r.resource).toBe('channel');
		expect(r.id).toBe('SomeName');
	});

	// docker

	it('classifies a docker user image', () => {
		const r = classifyLink('https://hub.docker.com/r/bitnami/nginx');
		expect(r.kind).toBe('docker');
		expect(r.provider).toBe('docker');
		expect(r.owner).toBe('bitnami');
		expect(r.repo).toBe('nginx');
		expect(r.label).toBe('bitnami/nginx');
	});

	it('classifies a docker official image', () => {
		const r = classifyLink('https://hub.docker.com/_/postgres');
		expect(r.kind).toBe('docker');
		expect(r.id).toBe('postgres');
		expect(r.label).toBe('postgres');
		expect(r.title).toBe('Docker Image postgres');
	});

	// spotify

	it('classifies a spotify track', () => {
		const r = classifyLink('https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6');
		expect(r.kind).toBe('spotify');
		expect(r.provider).toBe('spotify');
		expect(r.resource).toBe('track');
		expect(r.id).toBe('6rqhFgbbKwnb9MLmUQDhG6');
		expect(r.label).toBe('Spotify Track');
	});

	it('classifies a spotify album', () => {
		const r = classifyLink('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3');
		expect(r.resource).toBe('album');
		expect(r.label).toBe('Spotify Album');
	});

	it('classifies a spotify playlist', () => {
		const r = classifyLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
		expect(r.resource).toBe('playlist');
		expect(r.label).toBe('Spotify Playlist');
	});

	it('classifies a spotify artist', () => {
		const r = classifyLink('https://open.spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF');
		expect(r.resource).toBe('artist');
		expect(r.label).toBe('Spotify Artist');
	});

	// wikipedia

	it('classifies a wikipedia article', () => {
		const r = classifyLink('https://en.wikipedia.org/wiki/Cloudflare');
		expect(r.kind).toBe('wikipedia');
		expect(r.provider).toBe('wikipedia');
		expect(r.id).toBe('Cloudflare');
		expect(r.label).toBe('Cloudflare');
		expect(r.title).toBe('Wikipedia: Cloudflare');
	});

	it('turns wikipedia underscores into spaces for the label', () => {
		const r = classifyLink('https://en.wikipedia.org/wiki/Domain_Name_System');
		expect(r.id).toBe('Domain_Name_System');
		expect(r.label).toBe('Domain Name System');
	});

	it('decodes a percent-encoded wikipedia article', () => {
		const r = classifyLink('https://en.wikipedia.org/wiki/C%2B%2B');
		expect(r.id).toBe('C++');
		expect(r.label).toBe('C++');
	});
});

describe('clientUnfurlEndpoint', () => {
	it('builds the youtube oembed url for a video', () => {
		const link = classifyLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
		expect(clientUnfurlEndpoint(link)).toBe(
			'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ'
		);
	});

	it('returns null for a youtube channel (no video oembed)', () => {
		const link = classifyLink('https://www.youtube.com/@veritasium');
		expect(clientUnfurlEndpoint(link)).toBeNull();
	});

	it('builds the spotify oembed url', () => {
		const link = classifyLink('https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6');
		expect(clientUnfurlEndpoint(link)).toBe(
			'https://open.spotify.com/oembed?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F6rqhFgbbKwnb9MLmUQDhG6'
		);
	});

	it('builds the wikipedia rest summary url with the host language', () => {
		const en = classifyLink('https://en.wikipedia.org/wiki/Cloudflare');
		expect(clientUnfurlEndpoint(en)).toBe(
			'https://en.wikipedia.org/api/rest_v1/page/summary/Cloudflare'
		);

		const fr = classifyLink('https://fr.wikipedia.org/wiki/Chat');
		expect(clientUnfurlEndpoint(fr)).toBe('https://fr.wikipedia.org/api/rest_v1/page/summary/Chat');
	});

	it('builds the stackexchange questions url', () => {
		const link = classifyLink('https://stackoverflow.com/questions/11227809/why');
		expect(clientUnfurlEndpoint(link)).toBe(
			'https://api.stackexchange.com/2.3/questions/11227809?site=stackoverflow&filter=default'
		);
	});

	it('returns null for github and generic links', () => {
		expect(clientUnfurlEndpoint(classifyLink('https://github.com/earth-app/smoke/issues/1'))).toBe(
			null
		);
		expect(clientUnfurlEndpoint(classifyLink('https://example.com/foo'))).toBe(null);
	});
});

describe('normalizeClientUnfurl', () => {
	it('normalizes youtube oembed json', () => {
		const link = classifyLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
		const raw = {
			title: 'Rick Astley - Never Gonna Give You Up',
			thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
			provider_name: 'YouTube'
		};
		expect(normalizeClientUnfurl(link, raw)).toEqual({
			url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			title: 'Rick Astley - Never Gonna Give You Up',
			image: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
			siteName: 'YouTube'
		});
	});

	it('normalizes spotify oembed json', () => {
		const link = classifyLink('https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6');
		const raw = {
			title: 'Bohemian Rhapsody',
			thumbnail_url: 'https://i.scdn.co/image/abc',
			provider_name: 'Spotify'
		};
		expect(normalizeClientUnfurl(link, raw)).toEqual({
			url: 'https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6',
			title: 'Bohemian Rhapsody',
			image: 'https://i.scdn.co/image/abc',
			siteName: 'Spotify'
		});
	});

	it('normalizes wikipedia summary json with a thumbnail', () => {
		const link = classifyLink('https://en.wikipedia.org/wiki/Cloudflare');
		const raw = {
			title: 'Cloudflare',
			extract: 'Cloudflare, Inc. is an American company that provides CDN services.',
			thumbnail: { source: 'https://upload.wikimedia.org/cf.png' }
		};
		expect(normalizeClientUnfurl(link, raw)).toEqual({
			url: 'https://en.wikipedia.org/wiki/Cloudflare',
			title: 'Cloudflare',
			description: 'Cloudflare, Inc. is an American company that provides CDN services.',
			image: 'https://upload.wikimedia.org/cf.png'
		});
	});

	it('normalizes stackexchange json and decodes html entities in the title', () => {
		const link = classifyLink('https://stackoverflow.com/questions/11227809/why');
		const raw = {
			items: [{ title: 'Why is &quot;x&quot; &amp; y &lt;z&gt; and it&#39;s slow?' }]
		};
		expect(normalizeClientUnfurl(link, raw)).toEqual({
			url: 'https://stackoverflow.com/questions/11227809/why',
			title: `Why is "x" & y <z> and it's slow?`
		});
	});

	it('returns just the url when raw is empty', () => {
		const link = classifyLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
		expect(normalizeClientUnfurl(link, {})).toEqual({ url: link.url });
		expect(normalizeClientUnfurl(link, null)).toEqual({ url: link.url });
	});

	it('returns just the url for a non-object raw', () => {
		const link = classifyLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
		expect(normalizeClientUnfurl(link, 'not-json')).toEqual({ url: link.url });
	});

	it('returns just the url for a provider with no client-normalizer (generic)', () => {
		const link = classifyLink('https://github.com/earth-app/smoke/issues/1');
		expect(normalizeClientUnfurl(link, { anything: true })).toEqual({ url: link.url });
	});

	it('omits the image when a wikipedia summary has no thumbnail', () => {
		const link = classifyLink('https://en.wikipedia.org/wiki/Cloudflare');
		expect(normalizeClientUnfurl(link, { title: 'Cloudflare', extract: 'CDN co.' })).toEqual({
			url: link.url,
			title: 'Cloudflare',
			description: 'CDN co.',
			image: undefined
		});
	});

	it('yields an undefined title when stackexchange returns no items', () => {
		const link = classifyLink('https://stackoverflow.com/questions/11227809/why');
		expect(normalizeClientUnfurl(link, { items: [] })).toEqual({
			url: link.url,
			title: undefined
		});
	});
});

// every provider branch that fails its structural guard must degrade to `generic`
describe('classifyLink fall-through to generic', () => {
	it('treats a non-document google docs url as generic', () => {
		const r = classifyLink('https://docs.google.com/spreadsheets/d/abc/edit');
		expect(r.kind).toBe('generic');
		expect(r.host).toBe('docs.google.com');
	});

	it('classifies a single-segment gist as a gist keyed by its id', () => {
		const r = classifyLink('https://gist.github.com/aa5a315d61ae9438b18d');
		expect(r.kind).toBe('github-gist');
		expect(r.owner).toBeUndefined();
		expect(r.gistId).toBe('aa5a315d61ae9438b18d');
		expect(r.label).toBe('aa5a315d61ae9438b18d');
	});

	it('treats a github owner-only path as generic', () => {
		const r = classifyLink('https://github.com/earth-app');
		expect(r.kind).toBe('generic');
	});

	it('treats a github issue number of 0 as a repo (not > 0)', () => {
		const r = classifyLink('https://github.com/earth-app/smoke/issues/0');
		expect(r.kind).toBe('github-repo');
	});

	it('treats a non-numeric stackoverflow id as generic', () => {
		const r = classifyLink('https://stackoverflow.com/questions/abc/title');
		expect(r.kind).toBe('generic');
	});

	it('treats an unknown stackoverflow section as generic', () => {
		const r = classifyLink('https://stackoverflow.com/users/12345/jon');
		expect(r.kind).toBe('generic');
	});

	it('treats a non-browse atlassian url as generic', () => {
		const r = classifyLink('https://mycompany.atlassian.net/wiki/spaces/DEV');
		expect(r.kind).toBe('generic');
		expect(r.host).toBe('mycompany.atlassian.net');
	});

	it('treats a bare discord.gg url as generic', () => {
		const r = classifyLink('https://discord.gg/');
		expect(r.kind).toBe('generic');
		expect(r.host).toBe('discord.gg');
	});

	it('classifies a discordapp.com invite', () => {
		const r = classifyLink('https://discordapp.com/invite/abc');
		expect(r.kind).toBe('discord');
		expect(r.resource).toBe('invite');
		expect(r.id).toBe('abc');
	});

	it('treats an unknown discord.com path as generic', () => {
		const r = classifyLink('https://discord.com/login');
		expect(r.kind).toBe('generic');
	});

	it('treats an instagram root url as generic', () => {
		const r = classifyLink('https://instagram.com/');
		expect(r.kind).toBe('generic');
	});

	it('treats a bare youtu.be url as generic', () => {
		const r = classifyLink('https://youtu.be/');
		expect(r.kind).toBe('generic');
		expect(r.host).toBe('youtu.be');
	});

	it('treats a youtube watch url with no video id as generic', () => {
		const r = classifyLink('https://www.youtube.com/watch');
		expect(r.kind).toBe('generic');
	});

	it('treats an unknown youtube path as generic', () => {
		const r = classifyLink('https://www.youtube.com/feed/subscriptions');
		expect(r.kind).toBe('generic');
	});

	it('treats an unknown docker path as generic', () => {
		const r = classifyLink('https://hub.docker.com/search?q=nginx');
		expect(r.kind).toBe('generic');
	});

	it('classifies spotify show and episode resources', () => {
		expect(classifyLink('https://open.spotify.com/show/abc123').label).toBe('Spotify Show');
		expect(classifyLink('https://open.spotify.com/episode/def456').label).toBe('Spotify Episode');
	});

	it('treats an unknown spotify type as generic', () => {
		const r = classifyLink('https://open.spotify.com/collection/tracks');
		expect(r.kind).toBe('generic');
	});

	it('treats a non-/wiki/ wikipedia path as generic', () => {
		const r = classifyLink('https://en.wikipedia.org/w/index.php?title=Foo');
		expect(r.kind).toBe('generic');
	});
});

describe('clientUnfurlEndpoint edge cases', () => {
	it('defaults the language to en for a bare wikipedia.org host', () => {
		const link = classifyLink('https://wikipedia.org/wiki/Foo');
		expect(link.kind).toBe('wikipedia');
		expect(clientUnfurlEndpoint(link)).toBe(
			'https://en.wikipedia.org/api/rest_v1/page/summary/Foo'
		);
	});
});
