import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockQuery,
	seedCustomer,
	seedTicket
} from './route-runtime';

describe('POST /api/public/tickets', () => {
	it('creates a customer and ticket and returns a status token', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/public/tickets.post');

		mockBody({
			email: 'walkin@example.com',
			name: 'Walk In',
			title: 'Cannot log in',
			description: 'my password reset is broken'
		});
		const result = (await handler(eventFor(runtime.env))) as {
			ticket_id: number;
			status_token: string;
		};
		expect(typeof result.ticket_id).toBe('number');
		expect(typeof result.status_token).toBe('string');
		expect(result.status_token.length).toBeGreaterThan(0);

		const utils = await import('#server-utils');
		const customer = await utils.getCustomerByEmail('walkin@example.com', runtime.env);
		expect(customer?.name).toBe('Walk In');
	});
});

describe('GET /api/public/status', () => {
	it('returns public ticket fields for a valid token', async () => {
		const runtime = getRuntime();
		const create = await importRoute('~/server/api/public/tickets.post');
		mockBody({ email: 'status@example.com', title: 'Broken', description: 'details here' });
		const created = (await create(eventFor(runtime.env))) as {
			ticket_id: number;
			status_token: string;
		};

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: created.ticket_id, token: created.status_token });
		const result = (await handler(eventFor(runtime.env))) as any;
		expect(result.id).toBe(created.ticket_id);
		expect(result.title).toBe('Broken');
		expect(result.status).toBeDefined();
		expect(result.priority).toBeDefined();
		expect(Array.isArray(result.messages)).toBe(true);
	});

	it('rejects a wrong token with 403', async () => {
		const runtime = getRuntime();
		const create = await importRoute('~/server/api/public/tickets.post');
		mockBody({ email: 'wrong@example.com', title: 'Broken', description: 'details' });
		const created = (await create(eventFor(runtime.env))) as { ticket_id: number };

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: created.ticket_id, token: 'not-the-real-token' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 403 });
	});

	it('hides a private ticket as a 404 even with a valid token', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Priv', email: 'priv@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Secret',
			description: 'internal',
			customer_id: customer.id,
			private: true
		});

		const utils = await import('#server-utils');
		const token = await utils.hmacSha256(runtime.env.HMAC_SECRET, `status:${ticket.id}`);

		const handler = await importRoute('~/server/api/public/status.get');
		mockQuery({ id: ticket.id, token });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 404 });
	});
});
