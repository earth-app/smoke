import { beforeAll, describe, expect, it } from 'vitest';
import { cloudflareCapabilities } from '~/server/utils/cloudflare';
import { emailConfigStatus } from '~/server/utils/email';
import { Role } from '~/shared/types/user';
import { eventFor, getRuntime, importRoute, mockBody, seedAgent, seedUser } from './route-runtime';

// the server-utils barrel doesn't register the cloudflare util on globalThis; the cf
// routes reference its exports as nitro auto-imports, so wire them up for this suite
beforeAll(async () => {
	const cloudflare = await import('~/server/utils/cloudflare');
	for (const [key, value] of Object.entries(cloudflare)) {
		(globalThis as Record<string, unknown>)[key] = value;
	}
});

// every cf route hits the mock api path when MOCK_CF is set
function mockEnv() {
	return { ...getRuntime().env, MOCK_CF: '1' };
}

async function seedAdmin() {
	return await seedUser(getRuntime(), {
		username: 'admin',
		email: 'admin@example.com',
		role: Role.Admin
	});
}

describe('POST /api/cloudflare/link', () => {
	it('rejects a caller without ManageSettings', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('~/server/api/cloudflare/link.post');

		mockBody({ account_id: 'acct-1', token: 'tok-abcd' });
		await expect(handler(eventFor(mockEnv(), agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('stores token_last4 and never returns the token', async () => {
		const runtime = getRuntime();
		void runtime;
		const admin = await seedAdmin();
		const handler = await importRoute('~/server/api/cloudflare/link.post');

		mockBody({ account_id: 'acct-1', token: 'secret-token-wxyz' });
		const result = (await handler(eventFor(mockEnv(), admin.sessionToken))) as any;
		expect(result.account_id).toBe('acct-1');
		expect(result.token_last4).toBe('wxyz');
		expect(result.token).toBeUndefined();
		expect(JSON.stringify(result)).not.toContain('secret-token-wxyz');
	});

	it('rejects an invalid token with 400', async () => {
		const admin = await seedAdmin();
		const handler = await importRoute('~/server/api/cloudflare/link.post');

		mockBody({ account_id: 'acct-1', token: 'invalid-token' });
		await expect(handler(eventFor(mockEnv(), admin.sessionToken))).rejects.toMatchObject({
			statusCode: 400
		});
	});
});

describe('GET /api/cloudflare/status', () => {
	it('reports linked:false before linking', async () => {
		const admin = await seedAdmin();
		const handler = await importRoute('~/server/api/cloudflare/status.get');
		await expect(handler(eventFor(mockEnv(), admin.sessionToken))).resolves.toMatchObject({
			linked: false
		});
	});

	it('reports linked:true with zones after linking', async () => {
		const admin = await seedAdmin();

		const link = await importRoute('~/server/api/cloudflare/link.post');
		mockBody({ account_id: 'acct-1', token: 'secret-token-wxyz' });
		await link(eventFor(mockEnv(), admin.sessionToken));

		const status = await importRoute('~/server/api/cloudflare/status.get');
		const result = (await status(eventFor(mockEnv(), admin.sessionToken))) as any;
		expect(result.linked).toBe(true);
		expect(result.account_id).toBe('acct-1');
		expect(result.zones).toEqual([{ id: 'zone-mock', name: 'example.com' }]);
	});

	it('computes worker_wired via the catch-all read-back (false until provisioned)', async () => {
		const admin = await seedAdmin();

		const link = await importRoute('~/server/api/cloudflare/link.post');
		mockBody({ account_id: 'acct-1', token: 'secret-token-wxyz' });
		await link(eventFor(mockEnv(), admin.sessionToken));

		const status = await importRoute('~/server/api/cloudflare/status.get');
		const before = (await status(eventFor(mockEnv(), admin.sessionToken))) as any;
		expect(before.checklist.worker_wired).toBe(false);

		const provision = await importRoute('~/server/api/cloudflare/provision.post');
		mockBody({ zone_id: 'zone-mock', worker_name: 'smoke' });
		await provision(eventFor(mockEnv(), admin.sessionToken));

		const after = (await status(eventFor(mockEnv(), admin.sessionToken))) as any;
		expect(after.zones).toEqual([{ id: 'zone-mock', name: 'example.com' }]);
		expect(after.checklist.worker_wired).toBe(true);
	});
});

describe('GET /api/cloudflare/workers', () => {
	it('rejects a logged-in caller without ManageSettings', async () => {
		const agent = await seedAgent(getRuntime());
		const handler = await importRoute('~/server/api/cloudflare/workers.get');
		await expect(handler(eventFor(mockEnv(), agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('lists worker scripts after linking (mock returns smoke)', async () => {
		const admin = await seedAdmin();

		const link = await importRoute('~/server/api/cloudflare/link.post');
		mockBody({ account_id: 'acct-1', token: 'secret-token-wxyz' });
		await link(eventFor(mockEnv(), admin.sessionToken));

		const handler = await importRoute('~/server/api/cloudflare/workers.get');
		const result = (await handler(eventFor(mockEnv(), admin.sessionToken))) as any;
		expect(result.workers).toEqual([{ name: 'smoke' }]);
	});

	it('returns an empty list during first-run when nothing is linked yet', async () => {
		const handler = await importRoute('~/server/api/cloudflare/workers.get');
		const result = (await handler(eventFor(mockEnv()))) as any;
		expect(result.workers).toEqual([]);
	});

	it('lists workers during first-run when a token is already linked', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await utils.setJsonSetting('cloudflare', { account_id: 'acct-1' });
		const sealed = await utils.sealSecret('secret-token-wxyz', runtime.env.MASTER_KEY);
		await runtime.hubKv.set('smoke:setting:cloudflare_token', JSON.stringify(sealed));

		const handler = await importRoute('~/server/api/cloudflare/workers.get');
		const result = (await handler(eventFor(mockEnv()))) as any;
		expect(result.workers).toEqual([{ name: 'smoke' }]);
	});
});

describe('POST /api/cloudflare/provision', () => {
	it('returns steps that all succeed on the mock path', async () => {
		const admin = await seedAdmin();

		const link = await importRoute('~/server/api/cloudflare/link.post');
		mockBody({ account_id: 'acct-1', token: 'secret-token-wxyz' });
		await link(eventFor(mockEnv(), admin.sessionToken));

		const provision = await importRoute('~/server/api/cloudflare/provision.post');
		mockBody({ zone_id: 'zone-mock', worker_name: 'smoke' });
		const result = (await provision(eventFor(mockEnv(), admin.sessionToken))) as {
			steps: { name: string; ok: boolean }[];
		};
		expect(result.steps.length).toBeGreaterThan(0);
		expect(result.steps.every((s) => s.ok)).toBe(true);
	});

	it('allows provisioning during first-run when a token is linked (no admin yet)', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await utils.setJsonSetting('cloudflare', { account_id: 'acct-1' });
		const sealed = await utils.sealSecret('secret-token-wxyz', runtime.env.MASTER_KEY);
		await runtime.hubKv.set('smoke:setting:cloudflare_token', JSON.stringify(sealed));

		const provision = await importRoute('~/server/api/cloudflare/provision.post');
		mockBody({
			zone_id: 'zone-mock',
			worker_name: 'smoke',
			support_email: 'support@smoke.example.com'
		});
		const result = (await provision(eventFor(mockEnv()))) as {
			steps: { name: string; ok: boolean }[];
		};
		expect(result.steps.length).toBeGreaterThan(0);
		expect(result.steps.every((s) => s.ok)).toBe(true);
	});

	it('provisions during first-run with inline token/account before anything is sealed', async () => {
		// the wizard cloudflare step runs before init seals the token, so creds come in the body
		const provision = await importRoute('~/server/api/cloudflare/provision.post');
		mockBody({
			zone_id: 'zone-mock',
			worker_name: 'smoke',
			support_email: 'support@smoke.example.com',
			token: 'secret-token-wxyz',
			account_id: 'acct-1'
		});
		const result = (await provision(eventFor(mockEnv()))) as {
			steps: { name: string; ok: boolean }[];
		};
		expect(result.steps.every((s) => s.ok)).toBe(true);

		// account/zone/worker are persisted so later status agrees
		const utils = await import('#server-utils');
		const cf = await utils.getCloudflareSettings();
		expect(cf.account_id).toBe('acct-1');
		expect(cf.zone_id).toBe('zone-mock');
		expect(cf.worker_name).toBe('smoke');
	});
});

describe('DELETE /api/cloudflare/unlink', () => {
	it('clears the link so status reports linked:false', async () => {
		const admin = await seedAdmin();

		const link = await importRoute('~/server/api/cloudflare/link.post');
		mockBody({ account_id: 'acct-1', token: 'secret-token-wxyz' });
		await link(eventFor(mockEnv(), admin.sessionToken));

		const unlink = await importRoute('~/server/api/cloudflare/unlink.delete');
		await unlink(eventFor(mockEnv(), admin.sessionToken));

		const status = await importRoute('~/server/api/cloudflare/status.get');
		await expect(status(eventFor(mockEnv(), admin.sessionToken))).resolves.toMatchObject({
			linked: false
		});
	});
});

describe('cloudflareCapabilities', () => {
	it('grants features whose keyword appears in the scopes', () => {
		const byKey = Object.fromEntries(
			cloudflareCapabilities(['email', 'dns', 'workers']).map((c) => [c.key, c.granted])
		);
		expect(byKey.send).toBe(true);
		expect(byKey.routing).toBe(true);
		expect(byKey.dns).toBe(true);
		expect(byKey.workers).toBe(true);
	});

	it('blocks every feature when scopes are empty', () => {
		expect(cloudflareCapabilities([]).every((c) => !c.granted)).toBe(true);
	});
});

describe('POST /api/cloudflare/test', () => {
	it('reports capabilities for a valid token', async () => {
		const admin = await seedAdmin();
		const handler = await importRoute('~/server/api/cloudflare/test.post');
		mockBody({ token: 'secret-token-wxyz', account_id: 'acct-1' });
		const result = (await handler(eventFor(mockEnv(), admin.sessionToken))) as any;
		expect(result.valid).toBe(true);
		expect(result.capabilities.length).toBeGreaterThan(0);
		expect(result.capabilities.every((c: any) => c.granted)).toBe(true);
		expect(result.zones).toEqual([{ id: 'zone-mock', name: 'example.com' }]);
	});

	it('reports invalid for a bad token', async () => {
		const admin = await seedAdmin();
		const handler = await importRoute('~/server/api/cloudflare/test.post');
		mockBody({ token: 'invalid-token' });
		const result = (await handler(eventFor(mockEnv(), admin.sessionToken))) as any;
		expect(result.valid).toBe(false);
		expect(result.status).toBe('invalid');
	});

	it('rejects a logged-in caller without ManageSettings', async () => {
		const agent = await seedAgent(getRuntime());
		const handler = await importRoute('~/server/api/cloudflare/test.post');
		mockBody({ token: 'secret-token-wxyz' });
		await expect(handler(eventFor(mockEnv(), agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});

describe('POST /api/cloudflare/poll', () => {
	it('rejects a caller without ManageSettings', async () => {
		const agent = await seedAgent(getRuntime());
		const handler = await importRoute('~/server/api/cloudflare/poll.post');
		await expect(handler(eventFor(mockEnv(), agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('returns processed:0 when no mailbox poll is configured', async () => {
		const admin = await seedAdmin();
		const handler = await importRoute('~/server/api/cloudflare/poll.post');
		await expect(handler(eventFor(mockEnv(), admin.sessionToken))).resolves.toMatchObject({
			processed: 0
		});
	});
});

describe('POST /api/cloudflare/provision-email', () => {
	it('rejects a logged-in caller without ManageSettings', async () => {
		const agent = await seedAgent(getRuntime());
		const handler = await importRoute('~/server/api/cloudflare/provision-email.post');
		mockBody({ zone_id: 'zone-mock' });
		await expect(handler(eventFor(mockEnv(), agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('returns dkim/spf/mx fixtures on the mock path and reports configured', async () => {
		const admin = await seedAdmin();

		const link = await importRoute('~/server/api/cloudflare/link.post');
		mockBody({ account_id: 'acct-1', token: 'secret-token-wxyz' });
		await link(eventFor(mockEnv(), admin.sessionToken));

		const handler = await importRoute('~/server/api/cloudflare/provision-email.post');
		mockBody({ zone_id: 'zone-mock' });
		const result = (await handler(eventFor(mockEnv(), admin.sessionToken))) as any;

		expect(result.enabled).toBe(true);
		expect(result.records.length).toBeGreaterThan(0);
		expect(result.records.some((r: any) => /_domainkey/i.test(r.name))).toBe(true);
		expect(result.records.some((r: any) => r.type === 'MX')).toBe(true);
		// dns:edit is granted on the mock token, so records are auto-created
		expect(result.auto_created).toBe(true);
		// the persisted zone lets the status probe confirm onboarding
		expect(result.status).toMatchObject({ configured: true, needsOnboarding: false });
	});

	it('allows an unauthenticated caller during first-run setup (no admin yet)', async () => {
		const handler = await importRoute('~/server/api/cloudflare/provision-email.post');
		mockBody({ zone_id: 'zone-mock' });
		const result = (await handler(eventFor(mockEnv()))) as any;
		expect(result.records.length).toBeGreaterThan(0);
	});
});

describe('emailConfigStatus', () => {
	it('reports needsOnboarding for a placeholder token that has not onboarded a domain', async () => {
		// env token + support email resolve a transport, but nothing is verified yet
		const status = await emailConfigStatus(mockEnv());
		expect(status).toMatchObject({
			transport: 'cloudflare',
			configured: false,
			needsOnboarding: true
		});
	});

	it('reports not-configured when no deliberate token source exists', async () => {
		const env = { ...mockEnv(), CF_API_TOKEN: '', CF_EMAIL_TOKEN: '' };
		const status = await emailConfigStatus(env);
		expect(status).toMatchObject({
			transport: 'cloudflare',
			configured: false,
			needsOnboarding: false
		});
	});

	it('reports configured after the domain is onboarded via provision-email', async () => {
		const admin = await seedAdmin();

		const link = await importRoute('~/server/api/cloudflare/link.post');
		mockBody({ account_id: 'acct-1', token: 'secret-token-wxyz' });
		await link(eventFor(mockEnv(), admin.sessionToken));

		const provision = await importRoute('~/server/api/cloudflare/provision-email.post');
		mockBody({ zone_id: 'zone-mock' });
		await provision(eventFor(mockEnv(), admin.sessionToken));

		const status = await emailConfigStatus(mockEnv());
		expect(status).toMatchObject({ configured: true, needsOnboarding: false });
	});
});

describe('GET /api/cloudflare/email-status', () => {
	it('rejects a logged-in caller without ManageSettings', async () => {
		const agent = await seedAgent(getRuntime());
		const handler = await importRoute('~/server/api/cloudflare/email-status.get');
		await expect(handler(eventFor(mockEnv(), agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('returns the honest status for an admin', async () => {
		const admin = await seedAdmin();
		const handler = await importRoute('~/server/api/cloudflare/email-status.get');
		const result = (await handler(eventFor(mockEnv(), admin.sessionToken))) as any;
		expect(result).toHaveProperty('configured');
		expect(result).toHaveProperty('needsOnboarding');
		expect(result.transport).toBe('cloudflare');
	});
});
