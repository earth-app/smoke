import { describe, expect, it } from 'vitest';
import { eventFor, getRuntime, importRoute, mockBody, seedAgent } from '../route-runtime';

describe('POST /api/users/login', () => {
	it('returns a session token for valid credentials', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const created = await utils.createUser(
			'login_user',
			'login@example.com',
			undefined as never,
			runtime.env
		);
		await utils.setInitialPassword(created.id, 'StrongPass123!');
		const handler = await importRoute('~/server/api/users/login.post');

		mockBody({ usernameOrEmail: 'login_user', password: 'StrongPass123!' });

		const result = (await handler(eventFor(runtime.env))) as {
			success: boolean;
			session_token: string;
			user: { username: string };
		};
		expect(result.success).toBe(true);
		expect(result.session_token).toBeTypeOf('string');
		expect(result.user.username).toBe('login_user');
	});

	it('rejects invalid passwords with 401', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const created = await seedAgent(runtime);
		await utils.setInitialPassword(created.id, 'StrongPass123!');
		const handler = await importRoute('~/server/api/users/login.post');

		mockBody({ usernameOrEmail: 'agent_user', password: 'WrongPass1!' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 401 });
	});

	it('rejects login when password has not been set', async () => {
		const runtime = getRuntime();
		await seedAgent(runtime);
		const handler = await importRoute('~/server/api/users/login.post');

		mockBody({ usernameOrEmail: 'agent_user', password: 'StrongPass123!' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });
	});

	it('accepts email instead of username', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const created = await seedAgent(runtime);
		await utils.setInitialPassword(created.id, 'StrongPass123!');
		const handler = await importRoute('~/server/api/users/login.post');

		mockBody({ usernameOrEmail: 'agent@example.com', password: 'StrongPass123!' });
		const result = (await handler(eventFor(runtime.env))) as { success: boolean };
		expect(result.success).toBe(true);
	});
});
