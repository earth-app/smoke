import { describe, expect, it } from 'vitest';
import { eventFor, importRoute, TEST_ENV } from './route-runtime';

describe('GET /api/status', () => {
	it('returns the service status payload', async () => {
		const handler = await importRoute('../../src/server/api/status.get');
		await expect(handler(eventFor(TEST_ENV))).resolves.toEqual({
			status: 'ok',
			message: 'Hello world!'
		});
	});
});
