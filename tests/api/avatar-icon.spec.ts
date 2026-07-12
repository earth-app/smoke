import { describe, expect, it } from 'vitest';
import { Permission, Role } from '~/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedManager,
	seedUser
} from './route-runtime';

const POST = '~/server/api/users/[id]/avatar.post';
const GET = '~/server/api/users/[id]/avatar.get';

describe('POST /api/users/:id/avatar (icon)', () => {
	it('stores an icon avatar via the icon: sentinel', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute(POST);

		mockParams({ id: manager.id });
		mockBody({ icon: 'mdi:robot' });
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			avatar_url?: string;
		};

		expect(result.avatar_url).toBe('icon:mdi:robot');
		expect(runtime.blob.has(`avatar/${manager.id}`)).toBe(false);
	});

	it('rejects a caller without ChangeAvatar with 403', async () => {
		const runtime = getRuntime();
		// self-editable (ManageSelf) but explicitly lacking ChangeAvatar
		const user = await seedUser(runtime, {
			username: 'no_avatar_perm',
			email: 'noavatar@example.com',
			role: Role.Agent,
			permissions: [Permission.ManageSelf]
		});
		const handler = await importRoute(POST);

		mockParams({ id: user.id });
		mockBody({ icon: 'mdi:robot' });
		await expect(handler(eventFor(runtime.env, user.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});

describe('GET /api/users/:id/avatar (icon)', () => {
	it('returns 404 when the avatar is an icon value', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);

		const utils = await import('#server-utils');
		const loaded = await utils.getUserById(manager.id, runtime.env);
		if (!loaded) throw new Error('seed user missing');
		await utils.patchUser(loaded, { avatar_url: 'icon:mdi:robot' }, runtime.env);

		const handler = await importRoute(GET);
		mockParams({ id: manager.id });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 404 });
	});
});
