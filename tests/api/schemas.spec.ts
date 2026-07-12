import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus, TicketVisibility } from '~/shared/types/ticket';
import { Permission, Role } from '~/shared/types/user';
import {
	customerIdParam,
	labelIdParam,
	permissions,
	role,
	ticketIdParam,
	ticketPriority,
	ticketStatus,
	ticketVisibility
} from '~/shared/utils/schemas';

// schemas.ts hardcodes the enum values (it can't read Object.values(Enum) at module-eval:
// nuxt auto-imports make shared/types import schemas back, so touching the enum objects there
// tdz-crashes and 500s every ssr route). these tests fail if the hardcoded lists drift from the
// source enums, matching the compile-time `satisfies` guards in schemas.ts at runtime.
describe('shared enum schemas stay in sync with the source enums', () => {
	it('role accepts exactly the Role values', () => {
		expect(new Set(role.options)).toEqual(new Set(Object.values(Role)));
		for (const value of Object.values(Role)) expect(role.parse(value)).toBe(value);
		expect(() => role.parse('emperor')).toThrow();
	});

	it('ticketStatus accepts exactly the TicketStatus values', () => {
		expect(new Set(ticketStatus.options)).toEqual(new Set(Object.values(TicketStatus)));
		expect(() => ticketStatus.parse('deferred')).toThrow();
	});

	it('ticketPriority accepts exactly the TicketPriority values', () => {
		expect(new Set(ticketPriority.options)).toEqual(new Set(Object.values(TicketPriority)));
		expect(() => ticketPriority.parse('urgent')).toThrow();
	});

	it('ticketVisibility accepts exactly the TicketVisibility values', () => {
		expect(new Set(ticketVisibility.options)).toEqual(new Set(Object.values(TicketVisibility)));
		expect(() => ticketVisibility.parse('secret')).toThrow();
	});

	it('permissions accepts every Permission value and rejects unknown ones', () => {
		const all = Object.values(Permission);
		expect(permissions.parse(all)).toEqual(all);
		expect(permissions.parse([])).toEqual([]);
		expect(() => permissions.parse(['reply_ticket', 'not_a_real_permission'])).toThrow();
	});
});

// router params arrive as strings, so every numeric id param must coerce (else routes 400 in prod
// even though unit tests pass, since the harness mockParams bypasses the schema)
describe('numeric id route params coerce a string to a number', () => {
	it.each([
		['customerIdParam', customerIdParam],
		['labelIdParam', labelIdParam],
		['ticketIdParam', ticketIdParam]
	])('%s parses "1" to 1 and rejects non-positive / non-numeric', (_name, schema) => {
		expect(schema.parse('1')).toBe(1);
		expect(schema.parse(42)).toBe(42);
		expect(() => schema.parse('0')).toThrow();
		expect(() => schema.parse('-3')).toThrow();
		expect(() => schema.parse('abc')).toThrow();
	});
});
