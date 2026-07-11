// server-side link-preview enrichment; the ssrf guard in fetchUnfurl is the only gate (no auth)
export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	const { url } = getQuery(event);

	if (typeof url !== 'string' || url.length === 0) {
		throw createError({ statusCode: 400, message: 'A url query parameter is required' });
	}

	// heavy result is cached server-side in kv; keep a short client/edge cache too
	event.node.res.setHeader('Cache-Control', 'public, max-age=300');

	try {
		const preview = await fetchUnfurl(url, env);
		// thin { url } fallback keeps the client rendering gracefully instead of erroring
		return preview ?? { url, ok: false };
	} catch {
		return { url, ok: false };
	}
});
