import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBimiSvg, fallbackBimiSvg } from '~/server/utils/bimi';
import { parseDmarcRecord, provisionBimi, setMockCf } from '~/server/utils/cloudflare';
import { Role } from '~/shared/types/user';
import { eventFor, getRuntime, importRoute, mockBody, mockQuery, seedUser } from './route-runtime';

// the cf + bimi utils aren't on the #server-utils barrel; the routes read them as nitro auto-imports
beforeAll(async () => {
	for (const mod of [
		await import('~/server/utils/cloudflare'),
		await import('~/server/utils/bimi')
	]) {
		for (const [k, v] of Object.entries(mod)) (globalThis as Record<string, unknown>)[k] = v;
	}
});

beforeEach(() => {
	(globalThis as Record<string, unknown>).setHeader = vi.fn();
});

function mockEnv() {
	return { ...getRuntime().env, MOCK_CF: '1' };
}

// an iconify-style source: currentColor fill + 1em sizing that BIMI forbids
const ICON_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a10 10 0 100 20"/></svg>';

describe('buildBimiSvg', () => {
	it('produces a valid SVG Tiny P/S doc (version, baseProfile, square viewBox, title, fixed fill)', () => {
		const svg = buildBimiSvg(ICON_SVG, { title: 'Acme', fill: '#4285F4' });
		expect(svg).toContain('version="1.2"');
		expect(svg).toContain('baseProfile="tiny-ps"');
		expect(svg).toContain('viewBox="0 0 24 24"');
		expect(svg).toContain('<title>Acme</title>');
		expect(svg).toContain('#4285f4');
		// BIMI forbids currentColor + the 1em sizing carried by the source
		expect(svg).not.toContain('currentColor');
		expect(svg).not.toContain('1em');
	});

	it('strips the transparent placeholder path material/iconify emit', () => {
		const src =
			'<svg viewBox="0 0 24 24"><path fill="none" d="M0 0h24v24H0z"/><path fill="currentColor" d="M1 1"/></svg>';
		const svg = buildBimiSvg(src, { title: 'X', fill: '#000000' });
		expect(svg).not.toContain('fill="none"');
		expect(svg).toContain('d="M1 1"');
	});

	it('adds a background rect + stroke only for hex values', () => {
		const svg = buildBimiSvg(ICON_SVG, {
			title: 'X',
			fill: '#111111',
			background: '#ffffff',
			strokeColor: '#222222',
			strokeWidth: 1
		});
		expect(svg).toContain('<rect');
		expect(svg).toContain('fill="#ffffff"');
		expect(svg).toContain('stroke="#222222"');
		expect(svg).toContain('stroke-width="1"');
	});

	it('drops non-hex colors (BIMI forbids css vars / theme tokens)', () => {
		const svg = buildBimiSvg(ICON_SVG, { title: 'X', fill: 'primary', background: 'var(--ui-x)' });
		expect(svg).toContain('fill="#000000"');
		expect(svg).not.toContain('<rect');
	});

	it('escapes the title', () => {
		const svg = buildBimiSvg(ICON_SVG, { title: 'A & B <c>', fill: '#000000' });
		expect(svg).toContain('<title>A &amp; B &lt;c&gt;</title>');
	});

	it('folds an alpha hex fill into fill-opacity (partial transparency)', () => {
		const svg = buildBimiSvg(ICON_SVG, { title: 'X', fill: '#11223380' });
		expect(svg).toContain('fill="#112233"');
		expect(svg).toContain('fill-opacity="0.502"');
		expect(svg).not.toContain('#11223380');
	});

	it('keeps the background fully transparent when empty (no rect)', () => {
		const svg = buildBimiSvg(ICON_SVG, { title: 'X', fill: '#000000', background: '' });
		expect(svg).not.toContain('<rect');
	});

	it('supports a translucent background + stroke via alpha hex', () => {
		const svg = buildBimiSvg(ICON_SVG, {
			title: 'X',
			fill: '#000000',
			background: '#ffffff80',
			strokeColor: '#00000040',
			strokeWidth: 1
		});
		expect(svg).toContain('fill="#ffffff" fill-opacity="0.502"');
		expect(svg).toContain('stroke="#000000" stroke-opacity="0.251"');
	});
});

describe('fallbackBimiSvg', () => {
	it('is a valid BIMI svg used when no icon is configured', () => {
		const svg = fallbackBimiSvg({ title: 'X', fill: '#000000' });
		expect(svg).toContain('baseProfile="tiny-ps"');
		expect(svg).toContain('<title>X</title>');
		expect(svg).toContain('<circle');
	});
});

describe('parseDmarcRecord', () => {
	it('treats quarantine/reject at full coverage as enforced (BIMI-ready)', () => {
		expect(parseDmarcRecord('v=DMARC1; p=reject').enforced).toBe(true);
		expect(parseDmarcRecord('v=DMARC1; p=quarantine; pct=100').enforced).toBe(true);
	});

	it('is not enforced for p=none, pct<100, or a missing record', () => {
		expect(parseDmarcRecord('v=DMARC1; p=none').enforced).toBe(false);
		expect(parseDmarcRecord('v=DMARC1; p=quarantine; pct=50').enforced).toBe(false);
		expect(parseDmarcRecord(null).present).toBe(false);
		expect(parseDmarcRecord('not a dmarc record').present).toBe(false);
	});
});

describe('provisionBimi (mock)', () => {
	it('builds the default._bimi TXT pointing at the logo url', async () => {
		setMockCf(true);
		const result = await provisionBimi(
			'tok',
			'zone-1',
			'acme.test',
			'https://acme.test/bimi/logo.svg'
		);
		expect(result.record.name).toBe('default._bimi.acme.test');
		expect(result.record.content).toContain('v=BIMI1');
		expect(result.record.content).toContain('l=https://acme.test/bimi/logo.svg');
		expect(result.dmarc.enforced).toBe(true);
		setMockCf(false);
	});
});

describe('GET /bimi/logo.svg', () => {
	it('serves a valid BIMI svg from settings (fallback when no icon)', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await utils.setJsonSetting('bimi', { fill: '#4285F4', background: '#ffffff', title: 'Acme' });
		const handler = await importRoute('~/server/routes/bimi/logo.svg');
		mockQuery({});
		const svg = (await handler(eventFor(runtime.env))) as string;
		expect(svg).toContain('baseProfile="tiny-ps"');
		expect(svg).toContain('<title>Acme</title>');
		expect(svg).toContain('#4285f4');
	});

	it('lets query params override for a live preview', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/routes/bimi/logo.svg');
		mockQuery({ fill: '#ff0000', title: 'Preview' });
		const svg = (await handler(eventFor(runtime.env))) as string;
		expect(svg).toContain('#ff0000');
		expect(svg).toContain('<title>Preview</title>');
	});
});

describe('cloudflare BIMI routes (mock)', () => {
	async function linkAndConfigure() {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const admin = await seedUser(runtime, {
			username: 'admin',
			email: 'admin@example.com',
			role: Role.Admin
		});
		const link = await importRoute('~/server/api/cloudflare/link.post');
		mockBody({ account_id: 'acct-1', token: 'tok-abcd' });
		await link(eventFor(mockEnv(), admin.sessionToken));
		await utils.setJsonSetting('cloudflare', { account_id: 'acct-1', zone_id: 'zone-1' });
		await utils.setJsonSetting('email', { support_email: 'help@acme.test' });
		return admin;
	}

	it('provision-bimi publishes the record for a linked zone + support domain', async () => {
		const admin = await linkAndConfigure();
		const handler = await importRoute('~/server/api/cloudflare/provision-bimi.post');
		mockBody({});
		const result = (await handler(eventFor(mockEnv(), admin.sessionToken))) as any;
		expect(result.record.name).toBe('default._bimi.acme.test');
		expect(result.logo_url).toContain('/bimi/logo.svg');
		expect(result.dmarc.enforced).toBe(true);
	});

	it('bimi-status reports configured when the record + enforced dmarc exist', async () => {
		const admin = await linkAndConfigure();
		const handler = await importRoute('~/server/api/cloudflare/bimi-status.get');
		const result = (await handler(eventFor(mockEnv(), admin.sessionToken))) as any;
		expect(result.configured).toBe(true);
		expect(result.record).toContain('v=BIMI1');
		expect(result.dmarc.enforced).toBe(true);
	});

	it('bimi-status flags needs_link when no account is connected', async () => {
		const runtime = getRuntime();
		const admin = await seedUser(runtime, {
			username: 'admin2',
			email: 'admin2@example.com',
			role: Role.Admin
		});
		const handler = await importRoute('~/server/api/cloudflare/bimi-status.get');
		const result = (await handler(eventFor(mockEnv(), admin.sessionToken))) as any;
		expect(result.configured).toBe(false);
		expect(result.needs_link).toBe(true);
	});
});
