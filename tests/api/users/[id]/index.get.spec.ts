import { describe, expect, it } from 'vitest';
import { eventFor, getRuntime, importRoute, mockParams, seedAgent } from '../../route-runtime';

describe('GET /api/users/:id', () => {
	it('returns the user record for an existing id', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('~/server/api/users/[id]/index.get');

		mockParams({ id: agent.id });
		await expect(handler(eventFor(runtime.env))).resolves.toMatchObject({
			id: agent.id,
			username: 'agent_user',
			email: 'agent@example.com'
		});
	});

	it('returns the calling user when id="current"', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('~/server/api/users/[id]/index.get');

		mockParams({ id: 'current' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).resolves.toMatchObject({
			id: agent.id,
			username: 'agent_user'
		});
	});

	it('throws 404 when no user matches the id', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/users/[id]/index.get');

		mockParams({ id: '0'.repeat(32) });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 404 });
	});
});
