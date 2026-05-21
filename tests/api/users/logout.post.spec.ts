import { describe, expect, it } from 'vitest';
import { eventFor, getRuntime, importRoute, seedAgent } from '../route-runtime';

describe('POST /api/users/logout', () => {
	it('clears the session token of the calling user', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('../../../src/server/api/users/logout.post');

		await expect(handler(eventFor(runtime.env, agent.sessionToken))).resolves.toMatchObject({
			success: true,
			message: 'Logged out successfully'
		});

		// the same token must not work for a follow-up authenticated request
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 401
		});
	});

	it('rejects unauthenticated callers', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('../../../src/server/api/users/logout.post');
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 401 });
	});
});
