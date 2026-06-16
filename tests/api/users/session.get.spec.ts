import { describe, expect, it, vi } from 'vitest';
import { getRuntime, importRoute, mockCookie } from '../route-runtime';

describe('GET /api/users/session', () => {
	it('strips quoted/URL-encoded session cookies and refreshes them', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/users/session.get');
		const setCookie = (globalThis as any).setCookie as ReturnType<typeof vi.fn>;
		mockCookie('"abc%20123"');

		await expect(
			handler({ context: { cloudflare: { env: runtime.env } } } as any)
		).resolves.toEqual({ session_token: 'abc 123' });

		expect(setCookie).toHaveBeenCalledWith(
			expect.anything(),
			'session_token',
			'abc 123',
			expect.objectContaining({ httpOnly: false, secure: true })
		);
	});

	it('returns null when no cookie is set', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/users/session.get');
		mockCookie(null);

		await expect(
			handler({ context: { cloudflare: { env: runtime.env } } } as any)
		).resolves.toEqual({ session_token: null });
	});
});
