// serves the BIMI brand logo (SVG Tiny P/S) that the default._bimi dns record points at. reads the
// saved bimi settings; query params (icon/fill/bg/stroke/stroke_width/title) override for the live
// preview in the customizer. always returns a valid svg so the dns l= url never 404s to mail clients
export default defineEventHandler(async (event) => {
	const q = getQuery(event);
	const [bimi, themeColor, name] = await Promise.all([
		getBimiSettings(),
		getStringSetting('themeColor'),
		getStringSetting('name')
	]);

	const pick = (value: unknown, fallback: string) =>
		typeof value === 'string' && value.length ? value : fallback;

	const iconId = pick(q.icon, bimi.icon);
	const fill = pick(q.fill, bimi.fill || themeColor || '#000000');
	const background = q.bg !== undefined ? String(q.bg) : bimi.background;
	const strokeColor = q.stroke !== undefined ? String(q.stroke) : bimi.stroke_color;
	const strokeWidth = q.stroke_width !== undefined ? Number(q.stroke_width) : bimi.stroke_width;
	const title = pick(q.title, bimi.title || name || 'Logo');

	const options = { title, fill, background, strokeColor, strokeWidth };
	const source = iconId ? await fetchIconSvgSource(iconId) : null;
	const svg = source ? buildBimiSvg(source, options) : fallbackBimiSvg(options);

	setHeader(event, 'Content-Type', 'image/svg+xml; charset=utf-8');
	// mail clients refetch rarely; cache at the edge but let a settings change land within the hour
	setHeader(event, 'Cache-Control', 'public, max-age=3600');
	return svg;
});
