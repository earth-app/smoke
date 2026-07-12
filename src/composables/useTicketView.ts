import type { TicketEvent, TicketMessage } from '~/shared/types/ticket';

export type TicketViewOrder = 'asc' | 'desc';
export type TicketViewPrefs = { order: TicketViewOrder; compact: boolean };

// one merged timeline row: a message or a github-style event, ordered by created_at
export type ThreadEntry =
	| { type: 'message'; key: string; at: number; seq: number; message: TicketMessage }
	| { type: 'event'; key: string; at: number; seq: number; event: TicketEvent };

const STORAGE_KEY = 'smoke:ticket_view';
const DEFAULTS: TicketViewPrefs = { order: 'asc', compact: false };

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

// persisted thread view prefs (message order + compact rows); localStorage-backed, ssr-safe
export function useTicketView() {
	const prefs = useState<TicketViewPrefs>('ticket-view', () => ({ ...DEFAULTS }));

	const load = () => {
		if (import.meta.server) return;
		try {
			const raw = window.localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<TicketViewPrefs>;
			prefs.value = {
				order: parsed.order === 'desc' ? 'desc' : 'asc',
				compact: parsed.compact === true
			};
		} catch {
			prefs.value = { ...DEFAULTS };
		}
	};

	const persist = () => {
		if (import.meta.server) return;
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs.value));
		} catch {
			// ignore quota / unavailable storage
		}
	};

	const order = computed(() => prefs.value.order);
	const compact = computed(() => prefs.value.compact);

	const setOrder = (value: TicketViewOrder) => {
		prefs.value = { ...prefs.value, order: value };
		persist();
	};

	const toggleOrder = () => setOrder(prefs.value.order === 'asc' ? 'desc' : 'asc');

	const setCompact = (value: boolean) => {
		prefs.value = { ...prefs.value, compact: value };
		persist();
	};

	const toggleCompact = () => setCompact(!prefs.value.compact);

	if (import.meta.client) load();

	return { prefs, order, compact, setOrder, toggleOrder, setCompact, toggleCompact };
}
