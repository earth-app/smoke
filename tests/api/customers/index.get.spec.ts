import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockQuery,
	seedAgent,
	seedCustomer,
	seedManager
} from '../route-runtime';

describe('GET /api/customers', () => {
	it('lists customers for callers with ManageTicket', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		await seedCustomer(runtime, { name: 'Alice', email: 'alice@example.com' });
		await seedCustomer(runtime, { name: 'Bob', email: 'bob@example.com' });
		const handler = await importRoute('../../../src/server/api/customers/index.get');

		mockQuery({});
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as Array<{
			email: string;
		}>;
		expect(result.map((c) => c.email).sort()).toEqual(['alice@example.com', 'bob@example.com']);
	});

	it('rejects callers without ManageTicket', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('../../../src/server/api/customers/index.get');

		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('filters customers by case-insensitive search', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		await seedCustomer(runtime, { name: 'Alice', email: 'alice@example.com' });
		await seedCustomer(runtime, { name: 'Bob', email: 'bob@example.com' });
		const handler = await importRoute('../../../src/server/api/customers/index.get');

		mockQuery({ search: 'alice' });
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as Array<{
			email: string;
		}>;
		expect(result).toHaveLength(1);
		expect(result[0]?.email).toBe('alice@example.com');
	});
});
