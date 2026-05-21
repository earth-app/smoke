import { describe, expect, it } from 'vitest';
import { Permission } from '../../../../src/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedCustomer,
	seedManager,
	seedUser
} from '../../route-runtime';

describe('PATCH /api/customers/:id', () => {
	it('updates a customer when caller has ChangeCustomerName', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Alice',
			email: 'alice@example.com'
		});
		const handler = await importRoute('../../../../src/server/api/customers/[id]/index.patch');

		mockParams({ id: customer.id });
		mockBody({ name: 'Alice Updated' });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).resolves.toMatchObject({
			id: customer.id,
			name: 'Alice Updated'
		});
	});

	it('rejects name changes when caller lacks ChangeCustomerName', async () => {
		const runtime = getRuntime();
		// give the caller ManageTicket so the route gets past the customer-load guard
		const caller = await seedUser(runtime, {
			username: 'limited',
			email: 'limited@example.com',
			permissions: [Permission.ManageTicket]
		});
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Alice',
			email: 'alice@example.com'
		});
		const handler = await importRoute('../../../../src/server/api/customers/[id]/index.patch');

		mockParams({ id: customer.id });
		mockBody({ name: 'Alice Updated' });
		await expect(handler(eventFor(runtime.env, caller.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
		void manager;
	});

	it('throws 404 when customer does not exist', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute('../../../../src/server/api/customers/[id]/index.patch');

		mockParams({ id: 9999 });
		mockBody({ name: 'whoever' });
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
