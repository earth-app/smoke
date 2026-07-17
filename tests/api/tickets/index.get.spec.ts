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
} from '../route-runtime';

describe('GET /api/tickets', () => {
	it('lists public tickets for unauthenticated callers', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, {
			name: 'Cust',
			email: 'cust@example.com'
		});
		await seedTicket(runtime, {
			title: 'Public ticket',
			description: 'visible',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			private: false
		});
		await seedTicket(runtime, {
			title: 'Private ticket',
			description: 'hidden',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Low,
			private: true
		});
		const handler = await importRoute('~/server/api/tickets/index.get');

		mockQuery({});
		const result = (await handler(eventFor(runtime.env))) as Array<{ title: string }>;
		expect(result.map((t) => t.title)).toEqual(['Public ticket']);
	});

	it('includes private tickets when caller is an assignee', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Cust',
			email: 'cust@example.com'
		});
		await seedTicket(runtime, {
			title: 'Assigned private',
			description: 'visible to assignee',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			assignee_ids: [agent.id],
			private: true
		});
		const handler = await importRoute('~/server/api/tickets/index.get');

		mockQuery({});
		const result = (await handler(eventFor(runtime.env, agent.sessionToken))) as Array<{
			title: string;
		}>;
		expect(result.map((t) => t.title)).toEqual(['Assigned private']);
	});

	it('filters by status when a status list is supplied', async () => {
		const runtime = getRuntime();
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'cust@example.com' });
		await seedTicket(runtime, {
			title: 'Open one',
			description: 'd',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Medium,
			private: false
		});
		await seedTicket(runtime, {
			title: 'Closed one',
			description: 'd',
			customer_id: customer.id,
			status: TicketStatus.Closed,
			priority: TicketPriority.Medium,
			private: false
		});
		const handler = await importRoute('~/server/api/tickets/index.get');

		// the github-issues "open" default: submitted+open+pending+work_in_progress
		mockQuery({ status: 'submitted,open,pending,work_in_progress', archived: 'exclude' });
		const result = (await handler(eventFor(runtime.env))) as Array<{ title: string }>;
		expect(result.map((t) => t.title)).toEqual(['Open one']);
	});

	it('excludes archived tickets by default and returns only them for archived=only', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'cust@example.com' });
		const live = await seedTicket(runtime, {
			title: 'Live',
			description: 'd',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Medium,
			private: false
		});
		const gone = await seedTicket(runtime, {
			title: 'Archived',
			description: 'd',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.Medium,
			private: false
		});
		await utils.setTicketMeta(gone.id, { archived: true });
		const handler = await importRoute('~/server/api/tickets/index.get');

		mockQuery({ archived: 'exclude' });
		const excluded = (await handler(eventFor(runtime.env))) as Array<{ id: number }>;
		expect(excluded.map((t) => t.id)).toEqual([live.id]);

		mockQuery({ archived: 'only' });
		const only = (await handler(eventFor(runtime.env))) as Array<{ id: number }>;
		expect(only.map((t) => t.id)).toEqual([gone.id]);
	});

	it('shows every ticket to managers (ViewPrivateTickets unnecessary)', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const customer = await seedCustomer(runtime, {
			name: 'Cust',
			email: 'cust@example.com'
		});
		await seedTicket(runtime, {
			title: 'Public',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			private: false
		});
		await seedTicket(runtime, {
			title: 'Private',
			description: 'desc',
			customer_id: customer.id,
			status: TicketStatus.Open,
			priority: TicketPriority.High,
			private: true,
			assignee_ids: [manager.id]
		});
		const handler = await importRoute('~/server/api/tickets/index.get');

		mockQuery({});
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as Array<{
			title: string;
		}>;
		expect(result.map((t) => t.title).sort()).toEqual(['Private', 'Public']);
	});
});
