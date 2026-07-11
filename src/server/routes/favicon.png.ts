// resolve the configured png favicon; falls back to the favicon key, then the bundled static icon
export default defineEventHandler(async (event) => {
	const config = useRuntimeConfig();
	const fallback =
		config.public.faviconPng && config.public.faviconPng !== '/favicon.png'
			? config.public.faviconPng
			: '/_favicon.png';
	try {
		const favicon = (await getStringSetting('faviconPng')) || (await getStringSetting('favicon'));
		if (favicon && isIconifyId(favicon)) {
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
				const res = await proxyExternalAsset(favicon, 'image/png');
				if (res.ok) return res;
			} else if (favicon.startsWith('/') && favicon !== '/favicon.png') {
				return sendRedirect(event, favicon, 302);
			}
		}
	} catch (error) {
		console.warn('favicon.png resolution failed, using fallback:', error);
	}
	return sendRedirect(event, fallback, 302);
});
