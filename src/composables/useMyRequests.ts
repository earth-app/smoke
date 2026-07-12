export type SavedRequest = {
	id: number;
	token: string;
	title: string;
	created_at: number;
};

const STORAGE_KEY = 'smoke:my-requests';

// client-only list of tickets this browser has opened/viewed, so a guest can return without
// supplying their email; the status token is the capability, stored alongside the id
export function useMyRequests() {
	const requests = useState<SavedRequest[]>('my-requests', () => []);

	const load = () => {
		if (import.meta.server) return;
		try {
			const raw = window.localStorage.getItem(STORAGE_KEY);
			requests.value = raw ? (JSON.parse(raw) as SavedRequest[]) : [];
		} catch {
			requests.value = [];
		}
	};

	const persist = () => {
		if (import.meta.server) return;
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(requests.value));
		} catch {
			// ignore quota / unavailable storage
		}
	};

	const remember = (entry: SavedRequest) => {
		const rest = requests.value.filter((r) => r.id !== entry.id);
		requests.value = [entry, ...rest].slice(0, 50);
		persist();
	};

	const forget = (id: number) => {
		requests.value = requests.value.filter((r) => r.id !== id);
		persist();
	};

	const linkFor = (entry: Pick<SavedRequest, 'id' | 'token'>) =>
		`/status/${encodeURIComponent(entry.token)}?id=${entry.id}`;

	if (import.meta.client) load();

	return { requests, remember, forget, load, linkFor };
}
