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

	it('reports setup needed instead of 500 when the user read throws', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/setup/status.get');

		const realListUsers = (globalThis as any).listUsers;
		(globalThis as any).listUsers = () => {
			throw new Error('db unavailable');
		};
		try {
			await expect(handler(eventFor(runtime.env))).resolves.toMatchObject({
				needsSetup: true,
				userCount: 0
			});
		} finally {
			(globalThis as any).listUsers = realListUsers;
		}
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

	// 8-char password clears every rule except the 12-char floor hashPassword enforces; it used
	// to pass validation, then 500 in setInitialPassword after the admin row was already inserted
	it('rejects a password shorter than 12 chars without leaving a half-created admin', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/setup/init.post');

		bindValidator({ ...goodBody, password: 'Abcd123!' });
		await expect(handler(eventFor(runtime.env))).rejects.toBeTruthy();

		const status = await importRoute('~/server/api/setup/status.get');
		await expect(status(eventFor(runtime.env))).resolves.toMatchObject({
			needsSetup: true,
			userCount: 0
		});
	});

	it('creates an admin whose password works for login', async () => {
		const runtime = getRuntime();
		const initHandler = await importRoute('~/server/api/setup/init.post');
		mockBody(goodBody);
		await initHandler(eventFor(runtime.env));

		const loginHandler = await importRoute('~/server/api/users/login.post');
		mockBody({ usernameOrEmail: goodBody.username, password: goodBody.password });
		const result = (await loginHandler(eventFor(runtime.env))) as { success: boolean };
		expect(result.success).toBe(true);
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

	it('persists inbound poll settings and seals the poll password', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/setup/init.post');

		mockBody({
			...goodBody,
			settings: {
				email: {
					transport: 'cloudflare',
					support_email: 'help@example.com',
					poll: {
						enabled: true,
						protocol: 'imap',
						host: 'mail.example.com',
						port: 993,
						tls: 'implicit',
						username: 'poller',
						password: 'setup-poll-pass'
					}
				}
			}
		});
		await handler(eventFor(runtime.env));

		const utils = await import('#server-utils');
		const email = await utils.getEmailSettings();
		expect(email.poll?.enabled).toBe(true);
		expect(email.poll?.protocol).toBe('imap');
		expect((email.poll as { password?: string }).password).toBeUndefined();

		const config = await utils.getInboundPollConfig(runtime.env);
		expect(config?.connectOptions.auth.username).toBe('poller');
		expect(config?.connectOptions.auth.password).toBe('setup-poll-pass');
	});

	it('links cloudflare when the wizard provides an account and token', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/setup/init.post');

		mockBody({
			...goodBody,
			settings: { cloudflare: { account_id: 'acct-9', token: 'secret-token-wxyz' } }
		});
		await handler(eventFor({ ...runtime.env, MOCK_CF: '1' }));

		const utils = await import('#server-utils');
		const cf = await utils.getCloudflareSettings();
		expect(cf.account_id).toBe('acct-9');
		expect(cf.token_last4).toBe('wxyz');
	});

	it('mirrors the support email into the canonical top-level supportEmail setting', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('~/server/api/setup/init.post');

		mockBody({
			...goodBody,
			settings: { email: { transport: 'cloudflare', support_email: 'help@corp.com' } }
		});
		await handler(eventFor(runtime.env));

		const utils = await import('#server-utils');
		const all = await utils.getAllSettings();
		expect(all.supportEmail).toBe('help@corp.com');
		expect((all.email as { support_email?: string }).support_email).toBe('help@corp.com');
	});
});
