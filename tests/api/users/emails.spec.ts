import { describe, expect, it } from 'vitest';
import { Role } from '~/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedAgent,
	seedManager,
	seedUser
} from '../route-runtime';

describe('POST /api/users/:id/emails', () => {
	it('links a work mailbox to the target user (self + ManageSelf)', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('~/server/api/users/[id]/emails.post');

		mockParams({ id: agent.id });
		mockBody({ email: 'agent.work@mailbox.test' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).resolves.toMatchObject({
			success: true
		});

		const utils = await import('#server-utils');
		const resolved = await utils.resolveAgentByEmail(runtime.env, 'agent.work@mailbox.test');
		expect(resolved).toBe(agent.id);
	});

	it('lets a caller with ManageUsers link another user', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const target = await seedAgent(runtime, 'target_agent', 'target@example.com');
		const handler = await importRoute('~/server/api/users/[id]/emails.post');

		mockParams({ id: target.id });
		mockBody({ email: 'target.work@mailbox.test' });
		await handler(eventFor(runtime.env, manager.sessionToken));

		const utils = await import('#server-utils');
		const resolved = await utils.resolveAgentByEmail(runtime.env, 'target.work@mailbox.test');
		expect(resolved).toBe(target.id);
	});

	it('rejects an agent linking another user (no ManageUsers)', async () => {
		const runtime = getRuntime();
		const caller = await seedAgent(runtime, 'caller_agent', 'caller@example.com');
		const target = await seedUser(runtime, {
			username: 'other',
			email: 'other@example.com',
			role: Role.Agent
		});
		const handler = await importRoute('~/server/api/users/[id]/emails.post');

		mockParams({ id: target.id });
		mockBody({ email: 'other.work@mailbox.test' });
		await expect(handler(eventFor(runtime.env, caller.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});

describe('DELETE /api/users/:id/emails', () => {
	it('unlinks a previously linked mailbox', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const utils = await import('#server-utils');
		await utils.linkAgentEmail(runtime.env, 'agent.work@mailbox.test', agent.id);
		expect(await utils.resolveAgentByEmail(runtime.env, 'agent.work@mailbox.test')).toBe(agent.id);

		const handler = await importRoute('~/server/api/users/[id]/emails.delete');
		mockParams({ id: agent.id });
		mockBody({ email: 'agent.work@mailbox.test' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).resolves.toMatchObject({
			success: true
		});

		expect(await utils.resolveAgentByEmail(runtime.env, 'agent.work@mailbox.test')).toBeNull();
	});

	it('rejects an agent unlinking another user (no ManageUsers)', async () => {
		const runtime = getRuntime();
		const caller = await seedAgent(runtime, 'caller_agent', 'caller@example.com');
		const target = await seedUser(runtime, {
			username: 'other',
			email: 'other@example.com',
			role: Role.Agent
		});
		const handler = await importRoute('~/server/api/users/[id]/emails.delete');

		mockParams({ id: target.id });
		mockBody({ email: 'other.work@mailbox.test' });
		await expect(handler(eventFor(runtime.env, caller.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});
