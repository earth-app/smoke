import { allAllShardsGlobal } from '@earth-app/collegedb';
import { describe, expect, it } from 'vitest';
import { Role } from '~/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedAgent,
	seedCustomer,
	seedUser,
	type RouteRuntime
} from './route-runtime';

// a manager gets DEFAULT_PERMISSIONS[Manager], which includes ManageCustomers
async function seedManagerWithCustomers(
	rt: RouteRuntime
): Promise<{ id: string; sessionToken: string }> {
	return await seedUser(rt, {
		username: 'cust_mgr',
		email: 'cust_mgr@example.com',
		role: Role.Manager
	});
}

async function auditRows(action: string): Promise<any[]> {
	const res = await allAllShardsGlobal<any>('SELECT * FROM audit_log WHERE action = ?', [action]);
	return res.results;
}

describe('POST /api/customers', () => {
	it('creates a customer with an email and records a customer.created audit row', async () => {
		const runtime = getRuntime();
		const manager = await seedManagerWithCustomers(runtime);
		const handler = await importRoute('~/server/api/customers/index.post');

		mockBody({ name: 'Jane Doe', email: 'jane@example.com', tags: [] });
		const created = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			id: number;
			email: string;
			name?: string;
		};
		expect(created.email).toBe('jane@example.com');
		expect(created.name).toBe('Jane Doe');

		const rows = await auditRows('customer.created');
		const row = rows.find((r) => String(r.target_id) === String(created.id));
		expect(row).toBeTruthy();
		expect(row.actor_id).toBe(manager.id);
	});

	it('creates a guest customer with no email (email optional)', async () => {
		const runtime = getRuntime();
		const manager = await seedManagerWithCustomers(runtime);
		const handler = await importRoute('~/server/api/customers/index.post');

		mockBody({ name: 'Guest Person' });
		const created = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			id: number;
			email: string;
			name?: string;
		};
		expect(created.email).toBe('');
		expect(created.name).toBe('Guest Person');
	});

	it('rejects an agent without ManageCustomers with 403', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('~/server/api/customers/index.post');

		mockBody({ name: 'Blocked', email: 'blocked@example.com' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('allows a manager with ManageCustomers (200)', async () => {
		const runtime = getRuntime();
		const manager = await seedManagerWithCustomers(runtime);
		const handler = await importRoute('~/server/api/customers/index.post');

		mockBody({ name: 'Allowed', email: 'allowed@example.com' });
		const created = (await handler(eventFor(runtime.env, manager.sessionToken))) as { id: number };
		expect(typeof created.id).toBe('number');
	});
});

describe('POST /api/customers/[id]/magic-link', () => {
	it('mints a token, returns a portal url, and maps the token to the customer', async () => {
		const runtime = getRuntime();
		const manager = await seedManagerWithCustomers(runtime);
		const customer = await seedCustomer(runtime, { name: 'Mag', email: 'mag@example.com' });

		const mint = await importRoute('~/server/api/customers/[id]/magic-link.post');
		mockParams({ id: customer.id });
		const result = (await mint(eventFor(runtime.env, manager.sessionToken))) as {
			url: string;
			token: string;
		};

		expect(typeof result.token).toBe('string');
		expect(result.token.length).toBeGreaterThan(0);
		expect(result.url).toContain(`/portal/magic/${result.token}`);

		const mapped = await runtime.hubKv.get(`smoke:customer_magic:${result.token}`);
		expect(String(mapped)).toBe(String(customer.id));

		const rows = await auditRows('customer.magic_link_issued');
		expect(rows.some((r) => String(r.target_id) === String(customer.id))).toBe(true);
	});

	it('mints a link even for a customer with no email', async () => {
		const runtime = getRuntime();
		const manager = await seedManagerWithCustomers(runtime);

		const create = await importRoute('~/server/api/customers/index.post');
		mockBody({ name: 'Emailless' });
		const guest = (await create(eventFor(runtime.env, manager.sessionToken))) as { id: number };

		const mint = await importRoute('~/server/api/customers/[id]/magic-link.post');
		mockParams({ id: guest.id });
		const result = (await mint(eventFor(runtime.env, manager.sessionToken))) as { token: string };
		const mapped = await runtime.hubKv.get(`smoke:customer_magic:${result.token}`);
		expect(String(mapped)).toBe(String(guest.id));
	});

	it('404s for a missing customer', async () => {
		const runtime = getRuntime();
		const manager = await seedManagerWithCustomers(runtime);

		const mint = await importRoute('~/server/api/customers/[id]/magic-link.post');
		mockParams({ id: 999999 });
		await expect(mint(eventFor(runtime.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});

	it('rejects an agent without ManageCustomers with 403', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, { name: 'Mag2', email: 'mag2@example.com' });

		const mint = await importRoute('~/server/api/customers/[id]/magic-link.post');
		mockParams({ id: customer.id });
		await expect(mint(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});

describe('GET /api/portal/magic/[token]', () => {
	async function mintFor(runtime: RouteRuntime, managerToken: string, customerId: number) {
		const mint = await importRoute('~/server/api/customers/[id]/magic-link.post');
		mockParams({ id: customerId });
		return (await mint(eventFor(runtime.env, managerToken))) as { url: string; token: string };
	}

	it('exchanges a valid token for a customer session and returns ok', async () => {
		const runtime = getRuntime();
		const manager = await seedManagerWithCustomers(runtime);
		const customer = await seedCustomer(runtime, { name: 'Sess', email: 'sess-magic@example.com' });
		const { token } = await mintFor(runtime, manager.sessionToken, customer.id);

		const consume = await importRoute('~/server/api/portal/magic/[token].get');
		mockParams({ token });
		const res = (await consume(eventFor(runtime.env))) as { ok: boolean };
		expect(res.ok).toBe(true);

		// a customer session now resolves to this customer
		const keys = await runtime.hubKv.keys('smoke:customer_session_user:');
		expect(keys.length).toBeGreaterThan(0);
		let matched = false;
		for (const key of keys) {
			if (String(await runtime.hubKv.get(key)) === String(customer.id)) matched = true;
		}
		expect(matched).toBe(true);
	});

	it('is reusable within its window (a second consume still resolves)', async () => {
		const runtime = getRuntime();
		const manager = await seedManagerWithCustomers(runtime);
		const customer = await seedCustomer(runtime, { name: 'Reuse', email: 'reuse@example.com' });
		const { token } = await mintFor(runtime, manager.sessionToken, customer.id);

		const consume = await importRoute('~/server/api/portal/magic/[token].get');
		mockParams({ token });
		expect(((await consume(eventFor(runtime.env))) as { ok: boolean }).ok).toBe(true);
		mockParams({ token });
		expect(((await consume(eventFor(runtime.env))) as { ok: boolean }).ok).toBe(true);
	});

	it('rejects an unknown token with 400', async () => {
		const runtime = getRuntime();
		const consume = await importRoute('~/server/api/portal/magic/[token].get');
		mockParams({ token: 'not-a-real-token' });
		await expect(consume(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });
	});
});
