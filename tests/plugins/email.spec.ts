import { describe, expect, it } from 'vitest';
import { getRuntime } from '../api/route-runtime';

type EmailHandler = (payload: {
	message: Record<string, unknown>;
	env: typeof import('../api/route-runtime').TEST_ENV;
	context: unknown;
}) => Promise<void>;

async function loadEmailHandler(): Promise<EmailHandler> {
	const plugin = (await import('~/server/plugins/email')).default;
	let handler: EmailHandler | undefined;
	plugin({
		hooks: {
			hook: (name: string, fn: EmailHandler) => {
				if (name === 'cloudflare:email') {
					handler = fn;
				}
			}
		}
	} as any);
	if (!handler) throw new Error('cloudflare:email hook was not registered');
	return handler;
}

describe('cloudflare:email plugin', () => {
	it('creates a new customer and ticket when the sender is unknown', async () => {
		const runtime = getRuntime();
		const handler = await loadEmailHandler();

		await handler({
			message: {
				from: '"New User" <new@example.com>',
				subject: 'Support needed',
				text: 'Please help me with account setup.'
			},
			env: runtime.env,
			context: {}
		});

		const utils = await import('#server-utils');
		const customer = await utils.getCustomerByEmail('new@example.com', runtime.env);
		expect(customer?.email).toBe('new@example.com');
		expect(customer?.name).toBe('New User');

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', null);
		expect(tickets).toHaveLength(1);
		expect(tickets[0]?.title).toBe('Support needed');
		expect(tickets[0]?.description).toBe('Please help me with account setup.');
		expect(tickets[0]?.customer_id).toBe(customer!.id);
	});

	it('reuses an existing customer instead of creating a duplicate', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const existing = await utils.createCustomer(
			{ name: 'Existing', email: 'existing@example.com' },
			runtime.env
		);

		const handler = await loadEmailHandler();
		await handler({
			message: {
				from: 'existing@example.com',
				subject: 'Reply',
				text: 'still need help'
			},
			env: runtime.env,
			context: {}
		});

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', null);
		expect(tickets).toHaveLength(1);
		expect(tickets[0]?.customer_id).toBe(existing.id);
	});

	it('does nothing when the sender email cannot be parsed', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const handler = await loadEmailHandler();

		await handler({
			message: { from: 'not-an-email', subject: 'Ignored', text: 'ignored' },
			env: runtime.env,
			context: {}
		});

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', null);
		expect(tickets).toHaveLength(0);
	});

	it('extracts sender from an array of email addresses', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const handler = await loadEmailHandler();

		await handler({
			message: {
				from: ['noreply@example.com', '"Real Sender" <real@example.com>'],
				subject: 'Hi',
				text: 'body'
			},
			env: runtime.env,
			context: {}
		});

		// the parser walks the array and picks the first parseable entry
		const customer = await utils.getCustomerByEmail('noreply@example.com', runtime.env);
		expect(customer?.email).toBe('noreply@example.com');
	});

	it('extracts sender from an object with `address` and `personal` fields', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const handler = await loadEmailHandler();

		await handler({
			message: {
				from: { address: 'obj@example.com', personal: 'Object Sender' },
				subject: 'Hello',
				text: 'body'
			},
			env: runtime.env,
			context: {}
		});

		const customer = await utils.getCustomerByEmail('obj@example.com', runtime.env);
		expect(customer?.email).toBe('obj@example.com');
		expect(customer?.name).toBe('Object Sender');
	});

	it('falls back to default subject and body when the message omits them', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const handler = await loadEmailHandler();

		await handler({
			message: { from: 'minimal@example.com' },
			env: runtime.env,
			context: {}
		});

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', null);
		expect(tickets[0]?.title).toBe('New email');
		expect(tickets[0]?.description).toBe('Email received.');
	});
});
