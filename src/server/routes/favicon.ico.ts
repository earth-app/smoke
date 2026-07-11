// resolve the configured favicon; never 404/500 - always fall back to the bundled static icon
export default defineEventHandler(async (event) => {
	const config = useRuntimeConfig();
	const fallback =
		config.public.favicon && config.public.favicon !== '/favicon.ico'
			? config.public.favicon
			: '/_favicon.ico';
	try {
		const favicon = await getStringSetting('favicon');
		if (favicon && isIconifyId(favicon)) {
			// modern browsers accept svg at /favicon.ico; serve it instead of 404ing
			const color = (await getStringSetting('themeColor')) || config.public.themeColor || '';
			const res = await proxyExternalAsset(buildIconifyUrl(favicon, color), 'image/svg+xml');
			if (res.ok) return res;
		} else if (favicon) {
			const data = decodeDataUri(favicon);
			if (data) {
				setHeader(event, 'Content-Type', data.mimeType);
				setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
				return data.bytes;
			}
			if (/^https?:\/\//.test(favicon)) {
				const res = await proxyExternalAsset(favicon, 'image/x-icon');
				if (res.ok) return res;
			} else if (favicon.startsWith('/') && favicon !== '/favicon.ico') {
				return sendRedirect(event, favicon, 302);
			}
		}
	} catch (error) {
		console.warn('favicon.ico resolution failed, using fallback:', error);
	}
	return sendRedirect(event, fallback, 302);
});
