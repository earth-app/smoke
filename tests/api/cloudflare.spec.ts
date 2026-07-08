import { beforeAll, describe, expect, it } from 'vitest';
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
