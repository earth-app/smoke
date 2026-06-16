import { describe, expect, it } from 'vitest';
import { Permission } from '~/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	seedAgent,
	seedCustomer,
	seedManager,
	seedUser
} from '../route-runtime';

describe('POST /api/tickets', () => {
	it('creates a ticket when caller has CreateTicket', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Cust',
			email: 'cust@example.com'
		});
		const handler = await importRoute('~/server/api/tickets/index.post');

		mockBody({
			title: 'Broken thing',
			description: 'Something is broken',
			customer_id: customer.id
		});
		const result = (await handler(eventFor(runtime.env, agent.sessionToken))) as {
			title: string;
			id: number;
		};
		expect(result.title).toBe('Broken thing');
		expect(result.id).toBeGreaterThan(0);
	});

	it('rejects callers without CreateTicket', async () => {
		const runtime = getRuntime();
		const limited = await seedUser(runtime, {
			username: 'limited',
			email: 'limited@example.com',
			permissions: []
		});
		const customer = await seedCustomer(runtime, {
			name: 'Cust',
			email: 'cust@example.com'
		});
		const handler = await importRoute('~/server/api/tickets/index.post');

		mockBody({
			title: 'Nope',
			description: 'Nope',
			customer_id: customer.id
		});
		await expect(handler(eventFor(runtime.env, limited.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('rejects private flag when caller lacks TogglePrivate', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Cust',
			email: 'cust@example.com'
		});
		const handler = await importRoute('~/server/api/tickets/index.post');

		mockBody({
			title: 'Locked',
			description: 'Locked desc',
			customer_id: customer.id,
			private: true
		});
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('honors private flag when caller has TogglePrivate', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Cust',
			email: 'cust@example.com'
		});
		const handler = await importRoute('~/server/api/tickets/index.post');

		mockBody({
			title: 'Locked',
			description: 'Locked desc',
			customer_id: customer.id,
			private: true
		});
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			private: boolean;
		};
		expect(result.private).toBe(true);
		void Permission;
	});
});
