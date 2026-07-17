import { describe, expect, it } from 'vitest';
import type { TicketEvent, TicketMessage } from '~/shared/types/ticket';
import { deriveThreadUsers, mergeThreadEntries } from '~/utils/tickets';

const msg = (id: number, sender: any, at: any = id): TicketMessage =>
	({ id, sender, created_at: at }) as unknown as TicketMessage;

const evt = (id: number, at: any): TicketEvent =>
	({ id, kind: 'status', created_at: at }) as unknown as TicketEvent;

describe('deriveThreadUsers', () => {
	it('returns an empty list for no messages', () => {
		expect(deriveThreadUsers([])).toEqual([]);
	});

	it('collects distinct senders in first-seen order', () => {
		const a = { kind: 'user', id: 'u1', username: 'a' };
		const b = { kind: 'customer', id: 2 };
		const users = deriveThreadUsers([msg(1, a), msg(2, b)]);
		expect(users).toEqual([a, b]);
	});

	it('dedupes repeated senders by kind and id', () => {
		const a = { kind: 'user', id: 'u1', username: 'a' };
		const again = { kind: 'user', id: 'u1', username: 'a-copy' };
		const users = deriveThreadUsers([msg(1, a), msg(2, again), msg(3, a)]);
		expect(users).toHaveLength(1);
		expect(users[0]).toBe(a);
	});

	it('treats the same id under different kinds as distinct', () => {
		const u = { kind: 'user', id: '1', username: 'a' };
		const c = { kind: 'customer', id: 1 };
		expect(deriveThreadUsers([msg(1, u), msg(2, c)])).toHaveLength(2);
	});
});

describe('mergeThreadEntries', () => {
	it('returns an empty list for no messages or events', () => {
		expect(mergeThreadEntries([])).toEqual([]);
	});

	it('interleaves messages and events ordered by created_at ascending by default', () => {
		const sender = { kind: 'user', id: 'u1', username: 'a' };
		const entries = mergeThreadEntries([msg(1, sender, 100), msg(2, sender, 300)], [evt(9, 200)]);
		expect(entries.map((e) => e.key)).toEqual(['m:1', 'e:9', 'm:2']);
	});

	it('breaks created_at ties with the message id (events sort before via seq -1)', () => {
		const sender = { kind: 'user', id: 'u1', username: 'a' };
		const entries = mergeThreadEntries([msg(2, sender, 100), msg(1, sender, 100)], [evt(9, 100)]);
		// event seq is -1 so it sorts before messages on an equal timestamp, then id 1 before id 2
		expect(entries.map((e) => e.key)).toEqual(['e:9', 'm:1', 'm:2']);
	});

	it('reverses the order when desc is requested', () => {
		const sender = { kind: 'user', id: 'u1', username: 'a' };
		const entries = mergeThreadEntries(
			[msg(1, sender, 100), msg(2, sender, 300)],
			[evt(9, 200)],
			'desc'
		);
		expect(entries.map((e) => e.key)).toEqual(['m:2', 'e:9', 'm:1']);
	});

	it('treats null and invalid created_at as time 0', () => {
		const sender = { kind: 'user', id: 'u1', username: 'a' };
		const entries = mergeThreadEntries([msg(1, sender, null), msg(2, sender, 'not-a-date')]);
		expect(entries.every((e) => e.at === 0)).toBe(true);
		expect(entries.map((e) => e.key)).toEqual(['m:1', 'm:2']);
	});

	it('defaults events to an empty array', () => {
		const sender = { kind: 'user', id: 'u1', username: 'a' };
		const entries = mergeThreadEntries([msg(1, sender, 100)]);
		expect(entries).toHaveLength(1);
		expect(entries[0]!.type).toBe('message');
	});
});
