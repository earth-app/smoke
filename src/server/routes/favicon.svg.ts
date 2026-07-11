// serves iconify icons (tinted with the theme color); uploads/urls fall through to ico/png
export default defineEventHandler(async () => {
	const config = useRuntimeConfig();
	const favicon = (await getStringSetting('favicon')) || (await getStringSetting('faviconPng'));

	if (favicon && isIconifyId(favicon)) {
		const color = (await getStringSetting('themeColor')) || config.public.themeColor || '';
		return proxyExternalAsset(buildIconifyUrl(favicon, color), 'image/svg+xml');
	}

	throw createError({ statusCode: 404, message: 'No SVG favicon configured' });
});
