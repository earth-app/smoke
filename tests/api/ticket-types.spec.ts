import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus, TicketVisibility } from '~/shared/types/ticket';

// ticket.ts is otherwise type-only; the three enums are its sole runtime exports
describe('TicketStatus', () => {
	it('maps each member to its wire value', () => {
		expect(TicketStatus.Submitted).toBe('submitted');
		expect(TicketStatus.Open).toBe('open');
		expect(TicketStatus.Pending).toBe('pending');
		expect(TicketStatus.WorkInProgress).toBe('work_in_progress');
		expect(TicketStatus.Closed).toBe('closed');
		expect(TicketStatus.WontFix).toBe('wont_fix');
		expect(Object.values(TicketStatus)).toHaveLength(6);
	});
});

describe('TicketPriority', () => {
	it('maps each member to its wire value', () => {
		expect(TicketPriority.None).toBe('none');
		expect(TicketPriority.Low).toBe('low');
		expect(TicketPriority.Medium).toBe('medium');
		expect(TicketPriority.High).toBe('high');
		expect(TicketPriority.Critical).toBe('critical');
		expect(Object.values(TicketPriority)).toHaveLength(5);
	});
});

describe('TicketVisibility', () => {
	it('maps each member to its wire value', () => {
		expect(TicketVisibility.Public).toBe('public');
		expect(TicketVisibility.Internal).toBe('internal');
		expect(TicketVisibility.Private).toBe('private');
		expect(Object.values(TicketVisibility)).toHaveLength(3);
	});
});
