import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockParams,
	seedAgent,
	seedManager
} from '../../route-runtime';

describe('DELETE /api/users/:id', () => {
	it('deletes the targeted user when the caller has permission', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const target = await seedAgent(runtime);
		const handler = await importRoute('../../../../src/server/api/users/[id]/index.delete');

		mockParams({ id: target.id });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toBeNull();

		const row = await runtime.db
			.prepare('SELECT id FROM users WHERE id = ?')
			.bind(target.id)
			.first();
		expect(row).toBeNull();
	});

	it('rejects an agent attempting to delete another user', async () => {
		const runtime = getRuntime();
		const caller = await seedAgent(runtime, 'caller_agent', 'caller@example.com');
		const target = await seedAgent(runtime, 'other_agent', 'other@example.com');
		const handler = await importRoute('../../../../src/server/api/users/[id]/index.delete');

		mockParams({ id: target.id });
		await expect(handler(eventFor(runtime.env, caller.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('throws 404 when target user does not exist', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute('../../../../src/server/api/users/[id]/index.delete');

		mockParams({ id: '0'.repeat(32) });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
