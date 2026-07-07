import { defineStore } from 'pinia';
import type { Label } from '~/shared/types/user';
import { useAuthStore } from '~/stores/auth';

export const useLabelsStore = defineStore('labels', () => {
	const authStore = useAuthStore();

	const cache = reactive(new Map<number, Label>());
	const listInFlight = reactive(new Map<string, Promise<Label[]>>());
	const getInFlight = reactive(new Map<number, Promise<Label | null>>());

	const authHeaders = (): Record<string, string> => {
		const token = authStore.sessionToken;
		return token ? { Authorization: `Bearer ${token}` } : {};
	};

	const set = (label: Label) => {
		cache.set(label.id, label);
	};

	const get = (id: number): Label | undefined => cache.get(id);

	const listLabels = async (options?: QueryParameters): Promise<Label[]> => {
		const params = toSearchParams(options);
		const key = params.toString();

		const existing = listInFlight.get(key);
		if (existing) return existing;

		const promise = (async () => {
			try {
				const labels = await $fetch<Label[]>(`/api/labels?${key}`, {
					cache: 'no-store',
					credentials: 'include',
					headers: authHeaders()
				});
				labels.forEach(set);
				return labels;
			} catch (error) {
				console.error('Failed to list labels:', error);
				return [];
			} finally {
				listInFlight.delete(key);
			}
		})();

		listInFlight.set(key, promise);
		return promise;
	};

	const fetchLabel = async (id: number, force: boolean = false): Promise<Label | null> => {
		if (!force && cache.has(id)) return cache.get(id) || null;

		const existing = getInFlight.get(id);
		if (existing) return existing;

		const promise = (async () => {
			try {
				const label = await $fetch<Label>(`/api/labels/${id}`, {
					cache: 'no-store',
					credentials: 'include',
					headers: authHeaders()
				});
				set(label);
				return label;
			} catch (error) {
				console.error(`Failed to fetch label "${id}":`, error);
				return null;
			} finally {
				getInFlight.delete(id);
			}
		})();

		getInFlight.set(id, promise);
		return promise;
	};

	const createLabel = async (body: Partial<Label>): Promise<Label> => {
		try {
			const label = await $fetch<Label>(`/api/labels`, {
				method: 'POST',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			set(label);
			return label;
		} catch (error) {
			console.error('Failed to create label:', error);
			throw error;
		}
	};

	const patchLabel = async (id: number, body: Partial<Label>): Promise<Label> => {
		try {
			const label = await $fetch<Label>(`/api/labels/${id}`, {
				method: 'PATCH',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			set(label);
			return label;
		} catch (error) {
			console.error(`Failed to patch label "${id}":`, error);
			throw error;
		}
	};

	const deleteLabel = async (id: number): Promise<void> => {
		try {
			await $fetch(`/api/labels/${id}`, {
				method: 'DELETE',
				credentials: 'include',
				headers: authHeaders()
			});
			cache.delete(id);
		} catch (error) {
			console.error(`Failed to delete label "${id}":`, error);
			throw error;
		}
	};

	return {
		cache,
		get,
		set,
		listLabels,
		fetchLabel,
		createLabel,
		patchLabel,
		deleteLabel
	};
});
