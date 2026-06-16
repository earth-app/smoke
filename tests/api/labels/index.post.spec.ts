import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	seedAgent,
	seedManager
} from '../route-runtime';

describe('POST /api/labels', () => {
	it('creates a label when caller has ManageLabels', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute('~/server/api/labels/index.post');

		mockBody({ name: 'vip', color: '#112233' });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toMatchObject({
			name: 'vip',
			color: '#112233'
		});
	});

	it('rejects callers without ManageLabels', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('~/server/api/labels/index.post');

		mockBody({ name: 'vip' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});
