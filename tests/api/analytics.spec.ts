import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus } from '~/shared/types/ticket';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockQuery,
	seedAgent,
	seedCustomer,
	seedManager,
	seedTicket
} from './route-runtime';

describe('GET /api/analytics/summary', () => {
	it('aggregates tickets by status, priority, and day for a manager', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'cust@example.com' });

		await seedTicket(runtime, {
			title: 'Open low',
			description: 'a',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Low
		});
		await seedTicket(runtime, {
			title: 'Open high',
			description: 'b',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High
		});
		await seedTicket(runtime, {
			title: 'Closed',
			description: 'c',
			customer_id: customer.id,
			status: TicketStatus.Closed,
			priority: TicketPriority.Medium
		});
		await seedTicket(runtime, {
			title: 'Wont fix',
			description: 'd',
			customer_id: customer.id,
			status: TicketStatus.WontFix,
			priority: TicketPriority.Critical
		});

		const handler = await importRoute('~/server/api/analytics/summary.get');
		mockQuery({ range: 'all' });
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as any;

		expect(result.total).toBe(4);
		expect(result.by_status[TicketStatus.Open]).toBe(2);
		expect(result.by_status[TicketStatus.Closed]).toBe(1);
		expect(result.by_status[TicketStatus.WontFix]).toBe(1);
		expect(result.by_priority[TicketPriority.High]).toBe(1);
		expect(result.by_priority[TicketPriority.Critical]).toBe(1);
		// closed + wont_fix count as resolved
		expect(result.resolved).toBe(2);
		expect(result.open).toBe(2);
		expect(Array.isArray(result.volume_by_day)).toBe(true);
		expect(result.volume_by_day.reduce((n: number, d: any) => n + d.count, 0)).toBe(4);
		expect(result.volume_by_day[0]).toMatchObject({
			date: expect.any(String),
			count: expect.any(Number)
		});
	});

	it('rejects a caller without ManageTicket', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('~/server/api/analytics/summary.get');

		mockQuery({ range: '30d' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});
