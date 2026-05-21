import { describe, expect, it } from 'vitest';
import { Permission } from '../../../../src/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedAgent,
	seedManager
} from '../../route-runtime';

describe('PATCH /api/users/:id', () => {
	it('updates another user when caller has ManageUsers', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const target = await seedAgent(runtime);
		const handler = await importRoute('../../../../src/server/api/users/[id]/index.patch');

		mockParams({ id: target.id });
		mockBody({ username: 'agent_renamed', permissions: [Permission.ManageUsers] });

		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			username: string;
			permissions: Permission[];
		};
		expect(result.username).toBe('agent_renamed');
		expect(result.permissions).toContain(Permission.ManageUsers);

		const row = await runtime.db
			.prepare('SELECT username FROM users WHERE id = ?')
			.bind(target.id)
			.first<{ username: string }>();
		expect(row?.username).toBe('agent_renamed');
	});

	it('rejects an agent editing another user', async () => {
		const runtime = getRuntime();
		const callerAgent = await seedAgent(runtime, 'caller_agent', 'caller@example.com');
		const target = await seedAgent(runtime, 'other_agent', 'other@example.com');
		const handler = await importRoute('../../../../src/server/api/users/[id]/index.patch');

		mockParams({ id: target.id });
		mockBody({ username: 'should_not_apply' });

		await expect(handler(eventFor(runtime.env, callerAgent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('throws 404 when target user does not exist', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute('../../../../src/server/api/users/[id]/index.patch');

		mockParams({ id: '0'.repeat(32) });
		mockBody({ username: 'whoever' });

		await expect(handler(eventFor(runtime.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
