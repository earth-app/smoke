import type { TicketActor, TicketEvent, TicketMessage } from '~/shared/types/ticket';

export type TicketViewOrder = 'asc' | 'desc';
export type TicketViewPrefs = { order: TicketViewOrder; compact: boolean };

// one merged timeline row: a message or a github-style event, ordered by created_at
export type ThreadEntry =
	| { type: 'message'; key: string; at: number; seq: number; message: TicketMessage }
	| { type: 'event'; key: string; at: number; seq: number; event: TicketEvent };

function timeOf(value: string | number | Date | null | undefined): number {
	if (value == null) return 0;
	const t = new Date(value).getTime();
	return Number.isNaN(t) ? 0 : t;
}

// merge messages + timeline events into one list ordered by created_at (messages break ties by id)
export function mergeThreadEntries(
	messages: TicketMessage[],
	events: TicketEvent[] = [],
	order: TicketViewOrder = 'asc'
): ThreadEntry[] {
	const entries: ThreadEntry[] = [
		...messages.map((m) => ({
			type: 'message' as const,
			key: `m:${m.id}`,
			at: timeOf(m.created_at),
			seq: m.id,
			message: m
		})),
		...events.map((e) => ({
			type: 'event' as const,
			key: `e:${e.id}`,
			at: timeOf(e.created_at),
			seq: -1,
			event: e
		}))
	];
	entries.sort((a, b) => a.at - b.at || a.seq - b.seq);
	return order === 'desc' ? entries.reverse() : entries;
}

// distinct message senders, first-seen order, keyed by kind+id
export function deriveThreadUsers(messages: TicketMessage[]): TicketActor[] {
	const seen = new Set<string>();
	const users: TicketActor[] = [];
	for (const message of messages) {
		const key = `${message.sender.kind}:${message.sender.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		users.push(message.sender);
	}
	return users;
}
