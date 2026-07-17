export type BimiLogoOptions = {
	title: string;
	// solid fill for the mark; hex, optionally with an alpha channel (#rrggbbaa). BIMI forbids
	// currentColor / css vars, but SVG Tiny P/S allows *-opacity for partial transparency
	fill: string;
	// optional background rect; hex (+alpha) or empty for a fully transparent background
	background?: string;
	// optional stroke on the mark; hex (+alpha) + positive width, empty for no stroke
	strokeColor?: string;
	strokeWidth?: number;
};

// 3/4/6/8-digit hex; the 4 + 8 variants carry an alpha channel
const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isHexColor(value: string | undefined | null): boolean {
	return !!value && HEX_RE.test(value.trim());
}

// split an optionally-alpha hex into a 6-digit color + a 0..1 opacity (null = fully opaque)
export function splitHexAlpha(value: string): { color: string; opacity: number | null } {
	let hex = value.trim().replace(/^#/, '');
	// expand shorthand (#rgb / #rgba) to full form
	if (hex.length === 3 || hex.length === 4) {
		hex = hex
			.split('')
			.map((c) => c + c)
			.join('');
	}
	const color = `#${hex.slice(0, 6).toLowerCase()}`;
	if (hex.length === 8) {
		const alpha = parseInt(hex.slice(6, 8), 16) / 255;
		return { color, opacity: Math.round(alpha * 1000) / 1000 };
	}
	return { color, opacity: null };
}

// emit a fill/stroke attribute pair from a hex, folding any alpha into *-opacity (valid SVG Tiny)
function paint(attr: 'fill' | 'stroke', value: string): string {
	const { color, opacity } = splitHexAlpha(value);
	return opacity === null
		? `${attr}="${color}"`
		: `${attr}="${color}" ${attr}-opacity="${opacity}"`;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// drop the transparent placeholder rect/path material+iconify emit (e.g. <path fill="none" d="M0 0h24v24H0z"/>)
function stripTransparentShapes(inner: string): string {
	return inner.replace(/<(path|rect)\b[^>]*\bfill=["']none["'][^>]*?\/?>/gi, '');
}

// pull the viewBox + inner markup out of a source svg; defaults to a 24 grid
export function parseSvgSource(source: string): {
	viewBox: string;
	width: number;
	height: number;
	inner: string;
} {
	const vbMatch = source.match(/viewBox=["']([^"']+)["']/i);
	const viewBox = vbMatch?.[1]?.trim() || '0 0 24 24';
	const dims = viewBox.split(/[\s,]+/).map(Number);
	const rawW = dims[2];
	const rawH = dims[3];
	const width = typeof rawW === 'number' && Number.isFinite(rawW) && rawW > 0 ? rawW : 24;
	const height = typeof rawH === 'number' && Number.isFinite(rawH) && rawH > 0 ? rawH : 24;

	const svgOpen = source.search(/<svg\b/i);
	const openEnd = svgOpen >= 0 ? source.indexOf('>', svgOpen) : -1;
	const closeStart = source.lastIndexOf('</svg>');
	const inner =
		openEnd >= 0 && closeStart > openEnd ? source.slice(openEnd + 1, closeStart) : source;
	return { viewBox, width, height, inner };
}

// transform a raw (iconify) svg into a BIMI-compliant SVG Tiny P/S document
export function buildBimiSvg(source: string, options: BimiLogoOptions): string {
	const fillHex = isHexColor(options.fill) ? options.fill.trim() : '#000000';
	const { color: fillColor, opacity: fillOpacity } = splitHexAlpha(fillHex);
	const { viewBox, width, height, inner } = parseSvgSource(source);

	let content = stripTransparentShapes(inner);
	// BIMI forbids currentColor -> pin it to the solid fill (alpha rides on the group's fill-opacity)
	content = content.replace(/currentColor/g, fillColor);

	// empty background = fully transparent (no rect); a hex (+alpha) paints a solid/translucent rect
	const bg = isHexColor(options.background)
		? `<rect x="0" y="0" width="${width}" height="${height}" ${paint('fill', options.background!)}/>`
		: '';

	const strokeAttrs =
		isHexColor(options.strokeColor) && (options.strokeWidth ?? 0) > 0
			? ` ${paint('stroke', options.strokeColor!)} stroke-width="${options.strokeWidth}"`
			: '';

	const fillAttrs =
		fillOpacity === null
			? `fill="${fillColor}"`
			: `fill="${fillColor}" fill-opacity="${fillOpacity}"`;
	const title = escapeXml(options.title || 'Logo');

	return `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="${viewBox}"><title>${title}</title>${bg}<g ${fillAttrs}${strokeAttrs}>${content}</g></svg>`;
}

// a valid BIMI svg used when there's no icon configured or the icon fetch fails (the dns l= url must
// always return a parseable svg). an empty background stays transparent
export function fallbackBimiSvg(
	options: Pick<BimiLogoOptions, 'title' | 'fill' | 'background'>
): string {
	const fillHex = isHexColor(options.fill) ? options.fill.trim() : '#000000';
	const { color: fillColor, opacity: fillOpacity } = splitHexAlpha(fillHex);
	const fillAttrs =
		fillOpacity === null
			? `fill="${fillColor}"`
			: `fill="${fillColor}" fill-opacity="${fillOpacity}"`;
	const bg = isHexColor(options.background)
		? `<rect x="0" y="0" width="24" height="24" ${paint('fill', options.background!)}/>`
		: '';
	const title = escapeXml(options.title || 'Logo');
	return `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 24 24"><title>${title}</title>${bg}<circle cx="12" cy="12" r="7" ${fillAttrs}/></svg>`;
}

// pull the l= (logo) and a= (vmc/cmc cert) values out of a v=BIMI1 record; an empty a= tag -> null
export function parseBimiRecord(content: string | null): {
	logo: string | null;
	vmc: string | null;
} {
	if (!content) return { logo: null, vmc: null };
	const logo = content.match(/\bl=\s*([^;\s]+)/i)?.[1] ?? null;
	const vmcRaw = content.match(/\ba=\s*([^;\s]+)/i)?.[1] ?? null;
	const vmc = vmcRaw && /^https?:\/\//i.test(vmcRaw) ? vmcRaw : null;
	return { logo, vmc };
}

// fetch the raw svg source for an iconify icon id (e.g. mdi:earth); null on invalid id / fetch failure
export async function fetchIconSvgSource(iconId: string): Promise<string | null> {
	if (!isIconifyId(iconId)) return null;
	const [prefix, name] = iconId.trim().split(':');
	const url = `https://api.iconify.design/${prefix}/${name}.svg`;
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);
		const res = await fetch(url, { signal: controller.signal });
		clearTimeout(timeout);
		if (!res.ok) return null;
		const text = await res.text();
		return text.includes('<svg') ? text : null;
	} catch {
		return null;
	}
}
