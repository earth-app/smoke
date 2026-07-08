import { describe, expect, it } from 'vitest';
import { eventFor, getRuntime, importRoute, mockBody, seedManager } from './route-runtime';

const goodBody = {
	username: 'admin',
	email: 'admin@example.com',
	password: 'Sup3rSecret!'
};

// the harness mocks readValidatedBody as a bare fn; drive the real zod validator for a failure case
function bindValidator(body: unknown): void {
	const m = (globalThis as any).readValidatedBody as ReturnType<typeof import('vitest').vi.fn>;
	m.mockImplementation(async (_event: unknown, fn: (v: unknown) => unknown) => fn(body));
}

describe('GET /api/setup/status', () => {
	it('needs setup on an empty install', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/setup/status.get');
		await expect(handler(eventFor(runtime.env))).resolves.toMatchObject({
			needsSetup: true,
			userCount: 0
		});
	});

	it('does not need setup once a user exists', async () => {
		const runtime = getRuntime();
		await seedManager(runtime);
		const handler = await importRoute('~/server/api/setup/status.get');
		await expect(handler(eventFor(runtime.env))).resolves.toMatchObject({
			needsSetup: false,
			userCount: 1
		});
	});
});

describe('POST /api/setup/init', () => {
	it('creates the admin user and returns a session token', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/setup/init.post');

		mockBody(goodBody);
		const result = (await handler(eventFor(runtime.env))) as {
			success: boolean;
			user_id: string;
			session_token: string;
		};
		expect(result.success).toBe(true);
		expect(typeof result.user_id).toBe('string');
		expect(typeof result.session_token).toBe('string');
		expect(result.session_token.length).toBeGreaterThan(0);

		const utils = await import('#server-utils');
		const created = await utils.getUserById(result.user_id, runtime.env);
		expect(created?.username).toBe('admin');
	});

	it('rejects with 409 when a user already exists', async () => {
		const runtime = getRuntime();
		await seedManager(runtime);
		const handler = await importRoute('~/server/api/setup/init.post');

		mockBody(goodBody);
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 409 });
	});

	it('rejects a weak password', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/setup/init.post');

		bindValidator({ ...goodBody, password: 'weak' });
		await expect(handler(eventFor(runtime.env))).rejects.toBeTruthy();
	});

	it('rejects a bad email', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/setup/init.post');

		bindValidator({ ...goodBody, email: 'not-an-email' });
		await expect(handler(eventFor(runtime.env))).rejects.toBeTruthy();
	});

	it('persists provided email settings', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/setup/init.post');

		mockBody({
			...goodBody,
			settings: { email: { transport: 'cloudflare', support_email: 'help@example.com' } }
		});
		await handler(eventFor(runtime.env));

		const utils = await import('#server-utils');
		const email = await utils.getEmailSettings();
		expect(email.transport).toBe('cloudflare');
		expect(email.support_email).toBe('help@example.com');
	});
});
