import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedAgent,
	seedLabel,
	seedManager
} from '../../route-runtime';

describe('PATCH /api/labels/:id', () => {
	it('updates a label when caller has ManageLabels', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const label = await seedLabel(runtime, 'vip');
		const handler = await importRoute('~/server/api/labels/[id]/index.patch');

		mockParams({ id: label.id });
		mockBody({ name: 'vip-updated', color: '#445566' });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toMatchObject({
			name: 'vip-updated',
			color: '#445566'
		});
	});

	it('rejects callers without ManageLabels', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const label = await seedLabel(runtime, 'vip');
		const handler = await importRoute('~/server/api/labels/[id]/index.patch');

		mockParams({ id: label.id });
		mockBody({ name: 'vip-updated' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('throws 404 when label does not exist', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute('~/server/api/labels/[id]/index.patch');

		mockParams({ id: 9999 });
		mockBody({ name: 'whatever' });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
