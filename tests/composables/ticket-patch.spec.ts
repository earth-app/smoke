import { describe, expect, it } from 'vitest';
import type { Ticket } from '~/shared/types/ticket';
import { TicketPriority, TicketStatus, TicketVisibility } from '~/shared/types/ticket';
import { applyOptimisticPatch } from '~/utils/tickets';

const base = (): Ticket =>
	({
		id: 1,
		title: 'Original',
		description: 'desc',
		status: TicketStatus.Open,
		priority: TicketPriority.Low,
		visibility: TicketVisibility.Public,
		private: false,
		labels: [1],
		assignees: [{ id: 'a', username: 'agent' }],
		project_ids: [5],
		project_id: 5,
		customer_id: 0,
		created_at: new Date(),
		updated_at: new Date()
	}) as unknown as Ticket;

describe('applyOptimisticPatch', () => {
	it('applies scalar fields immediately and leaves the original untouched', () => {
		const before = base();
		const after = applyOptimisticPatch(before, {
			status: TicketStatus.Pending,
			priority: TicketPriority.High,
			visibility: TicketVisibility.Private,
			private: true,
			title: 'New'
		});
		expect(after.status).toBe(TicketStatus.Pending);
		expect(after.priority).toBe(TicketPriority.High);
		expect(after.visibility).toBe(TicketVisibility.Private);
		expect(after.private).toBe(true);
		expect(after.title).toBe('New');
		// pure: original object is not mutated (so a revert can restore it)
		expect(before.status).toBe(TicketStatus.Open);
		expect(before.title).toBe('Original');
	});

	it('derives project_id from project_ids[0]', () => {
		expect(applyOptimisticPatch(base(), { project_ids: [9, 3] }).project_id).toBe(9);
		expect(applyOptimisticPatch(base(), { project_ids: [] }).project_id).toBe(null);
	});

	it('does NOT touch assignees (server resolves ids to users)', () => {
		const after = applyOptimisticPatch(base(), { assignee_ids: ['b', 'c'] });
		expect(after.assignees).toEqual([{ id: 'a', username: 'agent' }]);
	});

	it('leaves untouched fields as they were', () => {
		const after = applyOptimisticPatch(base(), { status: TicketStatus.Closed });
		expect(after.priority).toBe(TicketPriority.Low);
		expect(after.labels).toEqual([1]);
	});
});
