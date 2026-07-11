// @nuxt/image registers an ipx handler at /_ipx/**; keep it from swallowing favicon requests
export default defineEventHandler((event) => {
	const url = getRequestURL(event);
	if (
		url.pathname.includes('/_ipx/') &&
		(url.pathname.endsWith('/favicon.png') ||
			url.pathname.endsWith('/favicon.ico') ||
			url.pathname.endsWith('/favicon.svg'))
	) {
		const path = url.pathname.endsWith('/favicon.png')
			? '/favicon.png'
			: url.pathname.endsWith('/favicon.svg')
				? '/favicon.svg'
				: '/favicon.ico';
		return sendRedirect(event, path, 302);
	}
});
