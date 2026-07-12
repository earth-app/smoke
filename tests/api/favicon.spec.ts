import { describe, expect, it } from 'vitest';
import { buildIconifyUrl, decodeDataUri, isIconifyId } from '~/server/utils/favicon-proxy';

describe('favicon-proxy', () => {
	it('detects iconify ids and rejects urls/paths/data-uris', () => {
		expect(isIconifyId('mdi:rocket-launch')).toBe(true);
		expect(isIconifyId('material-symbols:home-outline')).toBe(true);
		expect(isIconifyId('https://example.com/f.png')).toBe(false);
		expect(isIconifyId('/favicon.ico')).toBe(false);
		expect(isIconifyId('data:image/png;base64,AAAA')).toBe(false);
		expect(isIconifyId('just-text')).toBe(false);
	});

	it('builds a tinted iconify api url from an icon id', () => {
		const url = buildIconifyUrl('mdi:rocket-launch', '#3b82f6');
		expect(url.startsWith('https://api.iconify.design/mdi/rocket-launch.svg')).toBe(true);
		expect(url).toContain('height=256');
		expect(url).toContain('color=%233b82f6');
	});

	it('omits an invalid (non-hex) color', () => {
		const url = buildIconifyUrl('mdi:home', 'primary');
		expect(url).not.toContain('color=');
	});

	it('decodes a base64 data uri to bytes + mime', () => {
		const decoded = decodeDataUri('data:image/png;base64,QUJD');
		expect(decoded?.mimeType).toBe('image/png');
		expect(decoded ? Array.from(decoded.bytes) : []).toEqual([65, 66, 67]);
	});

	it('returns null for anything that is not a data uri', () => {
		expect(decodeDataUri('mdi:home')).toBeNull();
		expect(decodeDataUri('https://example.com/f.png')).toBeNull();
	});
});
