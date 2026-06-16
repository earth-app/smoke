import { describe, expect, it, vi } from 'vitest';
import { eventFor, getRuntime, importRoute, mockParams, seedManager } from '../../route-runtime';

const ROUTE = '../../../../src/server/api/users/[id]/avatar.get';

async function setAvatarUrl(
	env: typeof import('../../route-runtime').TEST_ENV,
	id: string,
	url: string
) {
	const utils = await import('#server-utils');
	const user = await utils.getUserById(id, env);
	if (!user) throw new Error('seed user missing');
	await utils.patchUser(user, { avatar_url: url }, env);
}

describe('GET /api/users/:id/avatar', () => {
	it('throws 404 when the user does not exist', async () => {
		const runtime = getRuntime();
		const handler = await importRoute(ROUTE);

		mockParams({ id: '0'.repeat(32) });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 404 });
	});

	it('throws 404 when the user has no avatar', async () => {
		const runtime = getRuntime();
		const user = await seedManager(runtime);
		const handler = await importRoute(ROUTE);

		mockParams({ id: user.id });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 404 });
	});

	it('redirects to an external https avatar url', async () => {
		const runtime = getRuntime();
		const user = await seedManager(runtime);
		await setAvatarUrl(runtime.env, user.id, 'https://cdn.example.com/a.png');
		const handler = await importRoute(ROUTE);
		const sendRedirect = (globalThis as Record<string, unknown>).sendRedirect as ReturnType<
			typeof vi.fn
		>;

		mockParams({ id: user.id });
		await handler(eventFor(runtime.env));

		expect(sendRedirect).toHaveBeenCalledWith(expect.anything(), 'https://cdn.example.com/a.png');
	});

	it('streams an uploaded ("local") avatar from blob storage', async () => {
		const runtime = getRuntime();
		const user = await seedManager(runtime);
		await runtime.blob.put(`avatar/${user.id}`, Buffer.from('image-bytes'), {
			contentType: 'image/png'
		});
		await setAvatarUrl(runtime.env, user.id, 'local');
		const handler = await importRoute(ROUTE);
		const sendStream = (globalThis as Record<string, unknown>).sendStream as ReturnType<
			typeof vi.fn
		>;

		const setHeader = vi.fn();
		const event = {
			node: { req: { headers: {} }, res: { setHeader } },
			context: { cloudflare: { env: runtime.env } }
		} as any;
		mockParams({ id: user.id });
		await handler(event);

		expect(sendStream).toHaveBeenCalled();
		expect(setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
	});

	it('throws 404 when avatar_url is "local" but no blob exists', async () => {
		const runtime = getRuntime();
		const user = await seedManager(runtime);
		await setAvatarUrl(runtime.env, user.id, 'local');
		const handler = await importRoute(ROUTE);

		mockParams({ id: user.id });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 404 });
	});
});
