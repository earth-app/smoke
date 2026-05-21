import { describe, expect, it } from 'vitest';
import { Role } from '../../../src/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	seedAgent,
	seedManager
} from '../route-runtime';

describe('POST /api/users', () => {
	it('creates a user when the caller has ManageUsers', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute('../../../src/server/api/users/index.post');

		mockBody({ username: 'new_user', email: 'new@example.com' });

		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toEqual({
			success: true,
			message: 'User new_user created successfully'
		});

		const utils = await import('~/server/utils');
		const created = await utils.getUserByUsername('new_user', runtime.env);
		expect(created).toMatchObject({ username: 'new_user', role: Role.Agent });
	});

	it('rejects callers without ManageUsers', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('../../../src/server/api/users/index.post');

		mockBody({ username: 'shouldnt_exist', email: 'no@example.com' });

		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('rejects unauthenticated requests', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('../../../src/server/api/users/index.post');

		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 401 });
	});
});
