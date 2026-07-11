import type { ClassifiedLink, UnfurlPreview } from '~/shared/utils/unfurl';

// module-level dedupe cache so the same url is enriched once across all embed instances
const cache = new Map<string, Promise<UnfurlPreview | null>>();

function isHttpUrl(url: string): boolean {
	return /^https?:\/\//i.test(url);
}

// a preview is only useful when it carries something to render beyond the bare url
function hasPreviewContent(preview: UnfurlPreview | null | undefined): preview is UnfurlPreview {
	return !!preview && !!(preview.title || preview.description || preview.image || preview.favicon);
}

// step 1: hit the provider's CORS-enabled public api directly from the browser
async function fetchClientEndpoint(link: ClassifiedLink): Promise<UnfurlPreview | null> {
	const endpoint = clientUnfurlEndpoint(link);
	if (!endpoint) return null;
	try {
		const json = await $fetch(endpoint);
		return normalizeClientUnfurl(link, json);
	} catch {
		// cors / network failure; caller falls through to the server route
		return null;
	}
}

// step 2: fall back to the server unfurl route, ignoring a thin { url } / { ok:false }
async function fetchServerFallback(url: string): Promise<UnfurlPreview | null> {
	try {
		const json = await $fetch<UnfurlPreview & { ok?: boolean }>('/api/unfurl', {
			query: { url }
		});
		if (!json || json.ok === false || !hasPreviewContent(json)) return null;
		return {
			url,
			title: json.title || undefined,
			description: json.description || undefined,
			image: json.image || undefined,
			favicon: json.favicon || undefined,
			siteName: json.siteName || undefined
		};
	} catch {
		return null;
	}
}

async function enrich(url: string): Promise<UnfurlPreview | null> {
	const link = classifyLink(url);
	const fromClient = await fetchClientEndpoint(link);
	if (fromClient) return fromClient;
	return fetchServerFallback(url);
}

/**
 * Best-effort client-side link enrichment for a single url; never throws, never blocks render.
 *
 * SSR stays null and hydrates on the client. Provider apis with CORS (youtube/spotify/wikipedia/
 * stackoverflow) are hit directly; everything else falls back to `GET /api/unfurl`. Resolved
 * previews are de-duplicated in a module cache so the same url is fetched once.
 */
export function useUnfurl(url: MaybeRefOrGetter<string>) {
	const preview = ref<UnfurlPreview | null>(null);
	const pending = ref(false);
	const classified = computed(() => classifyLink(toValue(url)));

	const load = async (target: string) => {
		if (!target || !isHttpUrl(target)) {
			preview.value = null;
			return;
		}

		let promise = cache.get(target);
		if (!promise) {
			promise = enrich(target);
			cache.set(target, promise);
		}

		pending.value = true;
		try {
			const result = await promise;
			// ignore a stale resolution if the url changed while awaiting
			if (toValue(url) === target) preview.value = result;
		} finally {
			if (toValue(url) === target) pending.value = false;
		}
	};

	// enrichment is a client concern only; server render keeps the structural fallback
	if (import.meta.client) {
		watch(
			() => toValue(url),
			(next) => {
				preview.value = null;
				void load(next);
			},
			{ immediate: true }
		);
	}

	return { preview, pending, classified };
}
