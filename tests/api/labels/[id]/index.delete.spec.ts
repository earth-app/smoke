import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockParams,
	seedAgent,
	seedLabel,
	seedManager
} from '../../route-runtime';

describe('DELETE /api/labels/:id', () => {
	it('deletes a label when caller has ManageLabels', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const label = await seedLabel(runtime, 'vip');
		const handler = await importRoute('../../../../src/server/api/labels/[id]/index.delete');

		mockParams({ id: label.id });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toBeNull();

		const row = await runtime.db
			.prepare('SELECT id FROM labels WHERE id = ?')
			.bind(label.id)
			.first();
		expect(row).toBeNull();
	});

	it('rejects callers without ManageLabels', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const label = await seedLabel(runtime, 'vip');
		const handler = await importRoute('../../../../src/server/api/labels/[id]/index.delete');

		mockParams({ id: label.id });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('throws 404 when label does not exist', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute('../../../../src/server/api/labels/[id]/index.delete');

		mockParams({ id: 9999 });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
