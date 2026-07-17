import { send as edgeportSend } from 'edgeport/smtp';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '~/shared/types/user';
import { eventFor, getRuntime, importRoute, mockBody, seedAgent, seedUser } from './route-runtime';

// test-email lazy-imports edgeport; mock it so the send path is observable without a socket
vi.mock('edgeport/smtp', () => ({
	send: vi.fn(async () => ({ accepted: [], response: '250 OK' }))
}));

describe('GET /api/settings', () => {
	it('returns public settings and never the smtp password', async () => {
		const runtime = getRuntime();
		const admin = await seedUser(runtime, {
			username: 'admin',
			email: 'admin@example.com',
			role: Role.Admin
		});

		const post = await importRoute('~/server/api/settings.post');
		mockBody({
			name: 'Acme Desk',
			email: {
				transport: 'smtp',
				smtp: {
					host: 'smtp.acme.test',
					port: 587,
					tls: 'starttls',
					username: 'acme',
					from: 'support@acme.test',
					password: 'super-secret'
				}
			}
		});
		await post(eventFor(runtime.env, admin.sessionToken));

		const get = await importRoute('~/server/api/settings.get');
		const settings = (await get(eventFor(runtime.env))) as any;
		expect(settings.name).toBe('Acme Desk');
		expect(settings.email.smtp.host).toBe('smtp.acme.test');
		expect(settings.email.smtp.password).toBeUndefined();
		// public-safe turnstile status; unconfigured in the default harness, never the secret
		expect(settings.turnstile).toEqual({
			configured: false,
			hasSiteKey: false,
			hasSecretKey: false
		});
	});
});

describe('POST /api/settings', () => {
	it('rejects a caller without ManageSettings', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('~/server/api/settings.post');

		mockBody({ name: 'Nope' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('mirrors the email support address into the top-level supportEmail', async () => {
		const runtime = getRuntime();
		const admin = await seedUser(runtime, {
			username: 'admin',
			email: 'admin@example.com',
			role: Role.Admin
		});
		const post = await importRoute('~/server/api/settings.post');
		mockBody({ email: { transport: 'cloudflare', support_email: 'help@acme.test' } });
		await post(eventFor(runtime.env, admin.sessionToken));

		const get = await importRoute('~/server/api/settings.get');
		const settings = (await get(eventFor(runtime.env))) as any;
		expect(settings.supportEmail).toBe('help@acme.test');
		expect(settings.email.support_email).toBe('help@acme.test');
	});

	it('seals the smtp password and resolves an smtp transport', async () => {
		const runtime = getRuntime();
		const admin = await seedUser(runtime, {
			username: 'admin',
			email: 'admin@example.com',
			role: Role.Admin
		});
		const handler = await importRoute('~/server/api/settings.post');

		mockBody({
			email: {
				transport: 'smtp',
				smtp: {
					host: 'smtp.acme.test',
					port: 465,
					tls: 'implicit',
					username: 'acme',
					from: 'support@acme.test',
					password: 'plaintext-pw'
				}
			}
		});
		const result = (await handler(eventFor(runtime.env, admin.sessionToken))) as any;
		// the returned settings must omit the plaintext password
		expect(result.email.smtp.password).toBeUndefined();

		const utils = await import('#server-utils');
		const transport = await utils.getEmailConfig(runtime.env);
		expect(transport?.hostname).toBe('smtp.acme.test');
		expect(transport?.tls).toBe('implicit');
		expect(transport?.auth?.username).toBe('acme');
		expect(transport?.auth?.password).toBe('plaintext-pw');
	});
});

describe('POST /api/settings inbound poll', () => {
	async function seedAdmin() {
		const runtime = getRuntime();
		const admin = await seedUser(runtime, {
			username: 'admin',
			email: 'admin@example.com',
			role: Role.Admin
		});
		const post = await importRoute('~/server/api/settings.post');
		return { runtime, admin, post };
	}

	it('seals the poll password, redacts it, and reports has_password', async () => {
		const { runtime, admin, post } = await seedAdmin();
		mockBody({
			email: {
				transport: 'cloudflare',
				support_email: 'help@acme.test',
				poll: {
					enabled: true,
					protocol: 'imap',
					host: 'mail.acme.test',
					port: 993,
					tls: 'implicit',
					username: 'poller',
					password: 'poll-secret'
				}
			}
		});
		const result = (await post(eventFor(runtime.env, admin.sessionToken))) as any;
		expect(result.email.poll.password).toBeUndefined();
		expect(result.email.poll.has_password).toBe(true);
		expect(result.email.poll.username).toBe('poller');
		expect(JSON.stringify(result)).not.toContain('poll-secret');

		const utils = await import('#server-utils');
		const config = await utils.getInboundPollConfig(runtime.env);
		expect(config?.connectOptions.auth.username).toBe('poller');
		expect(config?.connectOptions.auth.password).toBe('poll-secret');
	});

	it('reports has_password false when no poll password is stored', async () => {
		const { runtime, admin, post } = await seedAdmin();
		mockBody({
			email: {
				poll: {
					enabled: true,
					protocol: 'imap',
					host: 'mail.acme.test',
					port: 993,
					tls: 'implicit',
					username: 'poller'
				}
			}
		});
		const result = (await post(eventFor(runtime.env, admin.sessionToken))) as any;
		expect(result.email.poll.has_password).toBe(false);
	});

	it('does not overwrite an existing sealed poll password with an empty one', async () => {
		const { runtime, admin, post } = await seedAdmin();
		mockBody({
			email: {
				poll: {
					enabled: true,
					protocol: 'imap',
					host: 'mail.acme.test',
					port: 993,
					tls: 'implicit',
					username: 'first',
					password: 'first-pass'
				}
			}
		});
		await post(eventFor(runtime.env, admin.sessionToken));

		mockBody({
			email: {
				poll: {
					enabled: true,
					protocol: 'imap',
					host: 'mail.acme.test',
					port: 993,
					tls: 'implicit',
					username: 'second',
					password: ''
				}
			}
		});
		const result = (await post(eventFor(runtime.env, admin.sessionToken))) as any;
		expect(result.email.poll.has_password).toBe(true);

		const utils = await import('#server-utils');
		const config = await utils.getInboundPollConfig(runtime.env);
		expect(config?.connectOptions.auth.username).toBe('second');
		expect(config?.connectOptions.auth.password).toBe('first-pass');
	});
});

describe('POST /api/settings ai gating', () => {
	const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

	async function seedAdmin() {
		const runtime = getRuntime();
		const admin = await seedUser(runtime, {
			username: 'admin',
			email: 'admin@example.com',
			role: Role.Admin
		});
		const post = await importRoute('~/server/api/settings.post');
		return { runtime, admin, post };
	}

	it('enables ai under a mock cloudflare account', async () => {
		const { runtime, admin, post } = await seedAdmin();
		mockBody({ ai: { enabled: true, model: AI_MODEL } });
		const env = { ...runtime.env, MOCK_CF: '1' };
		const result = (await post(eventFor(env, admin.sessionToken))) as any;
		expect(result.ai.enabled).toBe(true);
	});

	it('rejects enabling ai with 422 when no cloudflare account is linked', async () => {
		const { runtime, admin, post } = await seedAdmin();
		mockBody({ ai: { enabled: true, model: AI_MODEL } });
		await expect(post(eventFor(runtime.env, admin.sessionToken))).rejects.toMatchObject({
			statusCode: 422
		});
	});

	it('allows saving ai settings while disabled without a cloudflare account', async () => {
		const { runtime, admin, post } = await seedAdmin();
		mockBody({ ai: { enabled: false, model: AI_MODEL } });
		const result = (await post(eventFor(runtime.env, admin.sessionToken))) as any;
		expect(result.ai.enabled).toBe(false);
	});
});

describe('POST /api/settings/test-email', () => {
	it('returns 400 when email is not configured', async () => {
		const runtime = getRuntime();
		const admin = await seedUser(runtime, {
			username: 'admin',
			email: 'admin@example.com',
			role: Role.Admin
		});
		const handler = await importRoute('~/server/api/settings/test-email.post');

		// strip the default cf transport env so no transport resolves
		const env = { ...runtime.env, CF_API_TOKEN: '', CF_EMAIL_TOKEN: '', SUPPORT_EMAIL: '' };
		mockBody({ to: 'someone@example.com' });
		await expect(handler(eventFor(env, admin.sessionToken))).rejects.toMatchObject({
			statusCode: 400
		});
	});

	it('sends via edgeport when a transport resolves', async () => {
		const runtime = getRuntime();
		const admin = await seedUser(runtime, {
			username: 'admin',
			email: 'admin@example.com',
			role: Role.Admin
		});
		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		sendMock.mockClear();

		const post = await importRoute('~/server/api/settings.post');
		mockBody({
			email: {
				transport: 'smtp',
				smtp: {
					host: 'smtp.acme.test',
					port: 465,
					tls: 'implicit',
					username: 'acme',
					from: 'support@acme.test',
					password: 'plaintext-pw'
				}
			}
		});
		await post(eventFor(runtime.env, admin.sessionToken));

		const handler = await importRoute('~/server/api/settings/test-email.post');
		mockBody({ to: 'target@example.com' });
		await expect(handler(eventFor(runtime.env, admin.sessionToken))).resolves.toMatchObject({
			success: true
		});

		expect(sendMock).toHaveBeenCalledTimes(1);
		const call = sendMock.mock.calls[0]![0];
		expect(call.to).toBe('target@example.com');
		expect(call.hostname).toBe('smtp.acme.test');
	});
});

describe('getEmailConfig cloudflare token resolution', () => {
	it('resolves the sealed (linked) cloudflare token, not just the env token', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');

		const sealed = await utils.sealSecret('linked-cf-token-xyz', runtime.env.MASTER_KEY);
		await (globalThis as any).kv.set('smoke:setting:cloudflare_token', JSON.stringify(sealed));
		await utils.setJsonSetting('email', {
			transport: 'cloudflare',
			support_email: 'help@corp.com'
		});

		const cfg = await utils.getEmailConfig(runtime.env);
		expect(cfg).not.toBeNull();
		// the sealed token wins over the env token (TEST_ENV.CF_API_TOKEN = 'cf-api-token')
		expect(cfg?.auth?.password).toBe('linked-cf-token-xyz');
		expect(await utils.isEmailConfigured(runtime.env)).toBe(true);
	});
});
