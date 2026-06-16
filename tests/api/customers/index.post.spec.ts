import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	seedAgent,
	seedManager
} from '../route-runtime';

describe('POST /api/customers', () => {
	it('creates a customer when caller has ManageTicket', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute('~/server/api/customers/index.post');

		mockBody({ name: 'Charlie', email: 'charlie@example.com' });
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			id: number;
			email: string;
		};
		expect(result.email).toBe('charlie@example.com');
		expect(result.id).toBeGreaterThan(0);
	});

	it('rejects callers without ManageTicket', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('~/server/api/customers/index.post');

		mockBody({ name: 'Charlie', email: 'charlie@example.com' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});
