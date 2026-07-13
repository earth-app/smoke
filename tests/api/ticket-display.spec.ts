import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus, TicketVisibility } from '~/shared/types/ticket';
import {
	PRIORITY_DISPLAY,
	prioritySelectItems,
	STATUS_DISPLAY,
	statusSelectItems,
	VISIBILITY_DISPLAY,
	visibilitySelectItems
} from '~/shared/utils/ticket-display';

const COLORS = ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'];

describe('display maps cover every enum key', () => {
	it('STATUS_DISPLAY has a well-formed entry for each TicketStatus', () => {
		for (const value of Object.values(TicketStatus)) {
			const meta = STATUS_DISPLAY[value];
			expect(meta).toBeDefined();
			expect(meta.label.length).toBeGreaterThan(0);
			expect(meta.icon).toMatch(/^mdi:/);
			expect(COLORS).toContain(meta.color);
			expect(meta.description!.length).toBeGreaterThan(0);
		}
	});

	it('PRIORITY_DISPLAY has a well-formed entry for each TicketPriority (no descriptions)', () => {
		for (const value of Object.values(TicketPriority)) {
			const meta = PRIORITY_DISPLAY[value];
			expect(meta).toBeDefined();
			expect(meta.label.length).toBeGreaterThan(0);
			expect(meta.icon).toMatch(/^mdi:/);
			expect(COLORS).toContain(meta.color);
			expect(meta.description).toBeUndefined();
		}
	});

	it('VISIBILITY_DISPLAY has a well-formed entry for each TicketVisibility', () => {
		for (const value of Object.values(TicketVisibility)) {
			const meta = VISIBILITY_DISPLAY[value];
			expect(meta).toBeDefined();
			expect(meta.label.length).toBeGreaterThan(0);
			expect(meta.icon).toMatch(/^mdi:/);
			expect(COLORS).toContain(meta.color);
			expect(meta.description!.length).toBeGreaterThan(0);
		}
	});
});

describe('select item builders', () => {
	it('statusSelectItems mirrors STATUS_DISPLAY with a chip and a description', () => {
		const items = statusSelectItems();
		expect(items).toHaveLength(Object.values(TicketStatus).length);
		const submitted = items.find((i) => i.value === TicketStatus.Submitted)!;
		expect(submitted.label).toBe(STATUS_DISPLAY[TicketStatus.Submitted].label);
		expect(submitted.icon).toBe(STATUS_DISPLAY[TicketStatus.Submitted].icon);
		expect(submitted.chip).toEqual({ color: STATUS_DISPLAY[TicketStatus.Submitted].color });
		expect(submitted.description).toBe(STATUS_DISPLAY[TicketStatus.Submitted].description);
	});

	it('prioritySelectItems omits the description key (priorities have none)', () => {
		const items = prioritySelectItems();
		expect(items).toHaveLength(Object.values(TicketPriority).length);
		for (const item of items) {
			expect(item.chip).toEqual({ color: PRIORITY_DISPLAY[item.value as TicketPriority].color });
			expect('description' in item).toBe(false);
		}
	});

	it('visibilitySelectItems mirrors VISIBILITY_DISPLAY with descriptions', () => {
		const items = visibilitySelectItems();
		expect(items).toHaveLength(Object.values(TicketVisibility).length);
		const priv = items.find((i) => i.value === TicketVisibility.Private)!;
		expect(priv.description).toBe(VISIBILITY_DISPLAY[TicketVisibility.Private].description);
		expect(priv.chip).toEqual({ color: VISIBILITY_DISPLAY[TicketVisibility.Private].color });
	});
});
