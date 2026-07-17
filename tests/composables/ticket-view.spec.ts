import { describe, expect, it } from 'vitest';
import type { TicketEvent, TicketMessage } from '~/shared/types/ticket';
import { mergeThreadEntries } from '~/utils/tickets';

const msg = (id: number, created_at: unknown): TicketMessage =>
	({ id, ticket_id: 1, created_at }) as unknown as TicketMessage;

const evt = (id: string, created_at: unknown): TicketEvent =>
	({ id, kind: 'status', created_at }) as unknown as TicketEvent;

describe('mergeThreadEntries', () => {
	it('interleaves messages + events ordered ascending by created_at', () => {
		const entries = mergeThreadEntries([msg(1, 100), msg(2, 300)], [evt('a', 200)]);
		expect(entries.map((e) => e.key)).toEqual(['m:1', 'e:a', 'm:2']);
	});

	it('reverses the order when desc is requested', () => {
		const entries = mergeThreadEntries([msg(1, 100), msg(2, 300)], [evt('a', 200)], 'desc');
		expect(entries.map((e) => e.key)).toEqual(['m:2', 'e:a', 'm:1']);
	});

	it('defaults events to an empty list', () => {
		const entries = mergeThreadEntries([msg(5, 100)]);
		expect(entries).toHaveLength(1);
		expect(entries[0]!.type).toBe('message');
		expect(entries[0]!.key).toBe('m:5');
	});

	it('breaks created_at ties by seq (events before messages, then message id)', () => {
		// event seq is -1 so it sorts ahead of same-timestamp messages; messages tie-break on id
		const entries = mergeThreadEntries([msg(2, 100), msg(1, 100)], [evt('x', 100)]);
		expect(entries.map((e) => e.key)).toEqual(['e:x', 'm:1', 'm:2']);
	});

	it('shapes message entries with type/key/at/seq and the original message', () => {
		const m = msg(7, 250);
		const [entry] = mergeThreadEntries([m], []);
		expect(entry).toMatchObject({ type: 'message', key: 'm:7', at: 250, seq: 7 });
		expect((entry as { message: TicketMessage }).message).toBe(m);
	});

	it('shapes event entries with seq -1 and the original event', () => {
		const e = evt('z', 250);
		const [entry] = mergeThreadEntries([], [e]);
		expect(entry).toMatchObject({ type: 'event', key: 'e:z', at: 250, seq: -1 });
		expect((entry as { event: TicketEvent }).event).toBe(e);
	});

	it('coerces a null created_at to time 0 (sorts to the front asc)', () => {
		const entries = mergeThreadEntries([msg(1, 500), msg(2, null)]);
		expect(entries.map((e) => e.key)).toEqual(['m:2', 'm:1']);
		expect(entries[0]!.at).toBe(0);
	});

	it('coerces an unparseable created_at to time 0', () => {
		const entries = mergeThreadEntries([msg(1, 'not-a-date')]);
		expect(entries[0]!.at).toBe(0);
	});

	it('parses ISO date strings for created_at', () => {
		const iso = '2026-01-01T00:00:00.000Z';
		const entries = mergeThreadEntries([msg(1, iso)]);
		expect(entries[0]!.at).toBe(new Date(iso).getTime());
	});

	it('returns an empty list when there is nothing to merge', () => {
		expect(mergeThreadEntries([], [])).toEqual([]);
	});
});
