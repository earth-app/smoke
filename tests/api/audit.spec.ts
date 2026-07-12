import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockQuery,
	seedAgent,
	seedManager
} from './route-runtime';

describe('audit util', () => {
	it('records an entry and lists it back', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await utils.recordAudit(runtime.env, {
			action: 'ticket.created',
			actorId: 'u1',
			actorName: 'Ann',
			ticketId: 5,
			priority: 'high',
			summary: 'opened #5',
			context: { title: 'Hi' }
		});
		const { results, total } = await utils.listAudit(runtime.env, {});
		expect(total).toBeGreaterThanOrEqual(1);
		const row = results.find((r) => r.action === 'ticket.created');
		expect(row?.actor_name).toBe('Ann');
		expect(row?.ticket_id).toBe(5);
		expect(row?.priority).toBe('high');
		expect(row?.context).toBe(JSON.stringify({ title: 'Hi' }));
	});

	it('filters by action / actor / ticket / priority / search', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await utils.recordAudit(runtime.env, {
			action: 'ticket.created',
			actorId: 'a',
			ticketId: 1,
			priority: 'normal',
			summary: 'alpha'
		});
		await utils.recordAudit(runtime.env, {
			action: 'customer.created',
			actorId: 'b',
			ticketId: 2,
			priority: 'high',
			summary: 'beta'
		});

		expect(
			(await utils.listAudit(runtime.env, { action: 'customer.created' })).results.every(
				(r) => r.action === 'customer.created'
			)
		).toBe(true);
		expect(
			(await utils.listAudit(runtime.env, { actorId: 'a' })).results.every(
				(r) => r.actor_id === 'a'
			)
		).toBe(true);
		expect(
			(await utils.listAudit(runtime.env, { ticketId: 2 })).results.every((r) => r.ticket_id === 2)
		).toBe(true);
		expect(
			(await utils.listAudit(runtime.env, { priority: 'high' })).results.every(
				(r) => r.priority === 'high'
			)
		).toBe(true);
		expect(
			(await utils.listAudit(runtime.env, { search: 'beta' })).results.some(
				(r) => r.summary === 'beta'
			)
		).toBe(true);
	});

	it('filters by time range and paginates with a total', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		for (let i = 0; i < 5; i += 1) {
			await utils.recordAudit(runtime.env, { action: 'label.created', summary: `L${i}` });
		}

		const all = await utils.listAudit(runtime.env, { action: 'label.created' });
		expect(all.total).toBeGreaterThanOrEqual(5);

		const page = await utils.listAudit(runtime.env, {
			action: 'label.created',
			limit: 2,
			offset: 0
		});
		expect(page.results.length).toBe(2);
		expect(page.total).toBeGreaterThanOrEqual(5);

		// a from-cutoff in the future excludes everything
		const future = Math.floor(Date.now() / 1000) + 100000;
		expect((await utils.listAudit(runtime.env, { from: future })).results.length).toBe(0);
	});

	it('purges rows older than a cutoff', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await utils.recordAudit(runtime.env, { action: 'auth.login', summary: 'old' });
		const future = Math.floor(Date.now() / 1000) + 100000;
		await utils.purgeAuditBefore(runtime.env, future);
		expect((await utils.listAudit(runtime.env, {})).total).toBe(0);
	});
});

describe('GET /api/audit', () => {
	it('rejects a caller without ViewAuditLog (403)', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('~/server/api/audit/index.get');
		mockQuery({});
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('returns filtered rows + parsed context for a manager', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const manager = await seedManager(runtime);
		await utils.recordAudit(runtime.env, {
			action: 'settings.updated',
			actorId: 'x',
			summary: 'changed',
			context: { section: 'branding' }
		});
		const handler = await importRoute('~/server/api/audit/index.get');
		mockQuery({ action: 'settings.updated' });
		const res = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			results: Array<{ action: string; context: unknown }>;
			total: number;
			page: number;
			limit: number;
		};
		expect(res.total).toBeGreaterThanOrEqual(1);
		expect(res.results.every((r) => r.action === 'settings.updated')).toBe(true);
		expect(res.results[0]?.context).toEqual({ section: 'branding' });
	});
});

describe('GET /api/audit/export', () => {
	it('exports csv by default with a header row and escaped quotes', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const manager = await seedManager(runtime);
		await utils.recordAudit(runtime.env, {
			action: 'ticket.created',
			actorName: 'Ann',
			summary: 'made with "quotes"'
		});
		const handler = await importRoute('~/server/api/audit/export.get');
		mockQuery({});
		const body = (await handler(eventFor(runtime.env, manager.sessionToken))) as string;
		expect(body.split('\n')[0]).toContain('action');
		expect(body).toContain('ticket.created');
		expect(body).toContain('""quotes""');
	});

	it('exports json as an array', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const manager = await seedManager(runtime);
		await utils.recordAudit(runtime.env, { action: 'user.created', summary: 'u' });
		const handler = await importRoute('~/server/api/audit/export.get');
		mockQuery({ format: 'json' });
		const body = (await handler(eventFor(runtime.env, manager.sessionToken))) as string;
		const parsed = JSON.parse(body) as Array<{ action: string }>;
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed.some((r) => r.action === 'user.created')).toBe(true);
	});

	it('exports txt and rejects a caller without permission', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const manager = await seedManager(runtime);
		const agent = await seedAgent(runtime);
		await utils.recordAudit(runtime.env, { action: 'auth.login', actorName: 'Bob', summary: 'in' });

		const handler = await importRoute('~/server/api/audit/export.get');
		mockQuery({ format: 'txt' });
		const body = (await handler(eventFor(runtime.env, manager.sessionToken))) as string;
		expect(body).toContain('auth.login by Bob');

		mockQuery({ format: 'txt' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});
