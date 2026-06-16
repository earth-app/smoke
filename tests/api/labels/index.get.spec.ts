import { describe, expect, it } from 'vitest';
import { eventFor, getRuntime, importRoute, seedAgent, seedLabel } from '../route-runtime';

describe('GET /api/labels', () => {
	it('returns all labels for any logged-in user', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		await seedLabel(runtime, 'vip', '#112233');
		await seedLabel(runtime, 'urgent');
		const handler = await importRoute('~/server/api/labels/index.get');

		const result = (await handler(eventFor(runtime.env, agent.sessionToken))) as Array<{
			name: string;
		}>;
		expect(result.map((l) => l.name).sort()).toEqual(['urgent', 'vip']);
	});

	it('rejects unauthenticated callers', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/labels/index.get');
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 401 });
	});
});
