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

describe('DELETE /api/customers/:id', () => {
	it('deletes the customer when caller has ManageTicket', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Alice',
			email: 'alice@example.com'
		});
		const handler = await importRoute('~/server/api/customers/[id]/index.delete');

		mockParams({ id: customer.id });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toBeNull();

		const row = await runtime.db
			.prepare('SELECT id FROM customers WHERE id = ?')
			.bind(customer.id)
			.first();
		expect(row).toBeNull();
	});

	it('rejects callers without ManageTicket', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Alice',
			email: 'alice@example.com'
		});
		const handler = await importRoute('~/server/api/customers/[id]/index.delete');

		mockParams({ id: customer.id });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('throws 404 when customer does not exist', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute('~/server/api/customers/[id]/index.delete');

		mockParams({ id: 9999 });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
