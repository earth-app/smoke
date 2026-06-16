import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockParams,
	seedAgent,
	seedManager
} from '../../route-runtime';

const ROUTE = '~/server/api/users/[id]/avatar.delete';

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

describe('DELETE /api/users/:id/avatar', () => {
	it('rejects an unauthenticated request with 401', async () => {
		const runtime = getRuntime();
		const user = await seedManager(runtime);
		const handler = await importRoute(ROUTE);

		mockParams({ id: user.id });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 401 });
	});

	it('removes a local avatar from blob storage and clears avatar_url', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		await runtime.blob.put(`avatar/${manager.id}`, Buffer.from('img'), {
			contentType: 'image/png'
		});
		await setAvatarUrl(runtime.env, manager.id, 'local');
		const handler = await importRoute(ROUTE);

		mockParams({ id: manager.id });
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			avatar_url?: string | null;
		};

		expect(result.avatar_url ?? null).toBeNull();
		expect(runtime.blob.has(`avatar/${manager.id}`)).toBe(false);
	});

	it('clears an external url avatar without touching blob storage', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		await setAvatarUrl(runtime.env, manager.id, 'https://cdn.example.com/a.png');
		const handler = await importRoute(ROUTE);

		mockParams({ id: manager.id });
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			avatar_url?: string | null;
		};

		expect(result.avatar_url ?? null).toBeNull();
	});

	it('rejects a caller without write access with 403', async () => {
		const runtime = getRuntime();
		const caller = await seedAgent(runtime, 'caller_agent', 'caller@example.com');
		const target = await seedManager(runtime, 'target_manager', 'target@example.com');
		const handler = await importRoute(ROUTE);

		mockParams({ id: target.id });
		await expect(handler(eventFor(runtime.env, caller.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});
