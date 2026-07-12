import { run } from '@earth-app/collegedb';
import { describe, expect, it } from 'vitest';
import { TicketStatus } from '~/shared/types/ticket';
import { getRuntime, seedCustomer, seedTicket } from './route-runtime';

const DAY_MS = 86_400_000;

async function ageUpdatedAt(id: number, days: number) {
	const seconds = Math.floor((Date.now() - days * DAY_MS) / 1000);
	await run(String(id), 'UPDATE tickets SET updated_at = ? WHERE id = ?', [seconds, id]);
}

async function loadRetention() {
	const mod = await import('~/server/tasks/retention/cleanup');
	return mod.runRetention;
}

describe('retention:cleanup', () => {
	it('archives a resolved ticket older than archive_days', async () => {
		const rt = getRuntime();
		const customer = await seedCustomer(rt, { name: 'Ann', email: 'ann@example.com' });
		const ticket = await seedTicket(rt, {
			title: 'Old closed',
			description: 'resolved long ago',
			customer_id: customer.id,
			status: TicketStatus.Closed
		});
		await ageUpdatedAt(ticket.id, 200);

		const runRetention = await loadRetention();
		const result = await runRetention(rt.env);
		expect(result.archived).toBe(1);
		expect(result.deleted).toBe(0);

		const utils = await import('#server-utils');
		const meta = await utils.getTicketMeta(ticket.id);
		expect(meta.archived).toBe(true);
	});

	it('leaves a recently-resolved ticket untouched', async () => {
		const rt = getRuntime();
		const customer = await seedCustomer(rt, { name: 'Ann', email: 'ann@example.com' });
		await seedTicket(rt, {
			title: 'Just closed',
			description: 'resolved today',
			customer_id: customer.id,
			status: TicketStatus.Closed
		});

		const runRetention = await loadRetention();
		const result = await runRetention(rt.env);
		expect(result.archived).toBe(0);
	});

	it('never archives an unresolved ticket even when stale', async () => {
		const rt = getRuntime();
		const customer = await seedCustomer(rt, { name: 'Ann', email: 'ann@example.com' });
		const ticket = await seedTicket(rt, {
			title: 'Old open',
			description: 'still open',
			customer_id: customer.id,
			status: TicketStatus.Open
		});
		await ageUpdatedAt(ticket.id, 200);

		const runRetention = await loadRetention();
		const result = await runRetention(rt.env);
		expect(result.archived).toBe(0);
	});

	it('purges a long-archived ticket when delete_days is a positive number', async () => {
		const rt = getRuntime();
		const utils = await import('#server-utils');
		await utils.setJsonSetting('retention', { archive_days: 90, delete_days: 30 });

		const customer = await seedCustomer(rt, { name: 'Ann', email: 'ann@example.com' });
		const ticket = await seedTicket(rt, {
			title: 'Long archived',
			description: 'archived ages ago',
			customer_id: customer.id
		});
		const oldIso = new Date(Date.now() - 60 * DAY_MS).toISOString();
		await utils.setTicketMeta(ticket.id, { archived: true, archived_at: oldIso });

		const runRetention = await loadRetention();
		const result = await runRetention(rt.env);
		expect(result.deleted).toBe(1);

		const gone = await utils.getTicketById(ticket.id, rt.env);
		expect(gone).toBeNull();
	});

	it('never purges when delete_days is null (default)', async () => {
		const rt = getRuntime();
		const utils = await import('#server-utils');

		const customer = await seedCustomer(rt, { name: 'Ann', email: 'ann@example.com' });
		const ticket = await seedTicket(rt, {
			title: 'Archived, no purge',
			description: 'archived but retained',
			customer_id: customer.id
		});
		const oldIso = new Date(Date.now() - 400 * DAY_MS).toISOString();
		await utils.setTicketMeta(ticket.id, { archived: true, archived_at: oldIso });

		const runRetention = await loadRetention();
		const result = await runRetention(rt.env);
		expect(result.deleted).toBe(0);

		const still = await utils.getTicketById(ticket.id, rt.env);
		expect(still).not.toBeNull();
	});
});
