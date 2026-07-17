import type { TicketViewOrder, TicketViewPrefs } from '~/utils/tickets';

const STORAGE_KEY = 'smoke:ticket_view';
const DEFAULTS: TicketViewPrefs = { order: 'asc', compact: false };

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
