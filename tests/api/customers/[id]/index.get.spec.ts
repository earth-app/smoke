import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockParams,
	seedAgent,
	seedCustomer,
	seedManager
} from '../../route-runtime';

describe('GET /api/customers/:id', () => {
	it('returns the customer for a valid id', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Alice',
			email: 'alice@example.com'
		});
		const handler = await importRoute('../../../../src/server/api/customers/[id]/index.get');

		mockParams({ id: customer.id });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toMatchObject({
			id: customer.id,
			email: 'alice@example.com'
		});
	});

	it('rejects callers without ManageTicket', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Alice',
			email: 'alice@example.com'
		});
		const handler = await importRoute('../../../../src/server/api/customers/[id]/index.get');

		mockParams({ id: customer.id });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('throws 404 when the customer does not exist', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute('../../../../src/server/api/customers/[id]/index.get');

		mockParams({ id: 9999 });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
