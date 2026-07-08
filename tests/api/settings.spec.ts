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
