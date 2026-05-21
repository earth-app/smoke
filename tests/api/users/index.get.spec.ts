import { describe, expect, it } from 'vitest';
import { eventFor, getRuntime, importRoute, mockQuery, seedManager } from '../route-runtime';

describe('GET /api/users', () => {
	it('lists every user encrypted through CollegeDB and returns them via the route', async () => {
		const runtime = getRuntime();
		await seedManager(runtime);
		const handler = await importRoute('../../../src/server/api/users/index.get');

		mockQuery({});

		const result = (await handler(eventFor(runtime.env))) as Array<{ username: string }>;
		expect(result.map((u) => u.username)).toEqual(['manager_user']);
	});

	it('paginates and sorts via query params', async () => {
		const runtime = getRuntime();
		await seedManager(runtime, 'alpha', 'alpha@example.com');
		await seedManager(runtime, 'bravo', 'bravo@example.com');
		const handler = await importRoute('../../../src/server/api/users/index.get');

		mockQuery({ page: '1', limit: '1', sort: 'username', sort_direction: 'asc' });
		const page1 = (await handler(eventFor(runtime.env))) as Array<{ username: string }>;
		expect(page1.map((u) => u.username)).toEqual(['alpha']);

		mockQuery({ page: '2', limit: '1', sort: 'username', sort_direction: 'asc' });
		const page2 = (await handler(eventFor(runtime.env))) as Array<{ username: string }>;
		expect(page2.map((u) => u.username)).toEqual(['bravo']);
	});
});
