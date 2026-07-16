import { defineStore } from 'pinia';
import type { TicketFlow } from '~/shared/types/ticket';
import { useAuthStore } from '~/stores/auth';

export type FlowInput = {
	name: string;
	enabled?: boolean;
	trigger: TicketFlow['trigger'];
	match?: TicketFlow['match'];
	conditions?: TicketFlow['conditions'];
	actions: TicketFlow['actions'];
};

export const useFlowsStore = defineStore('flows', () => {
	// request-scoped so internal api reads route in-process during ssr (avoids the self-loopback stall)
	const requestFetch = useRequestFetch();
	const authStore = useAuthStore();

	const flows = ref<TicketFlow[]>([]);
	const fetchPromise = ref<Promise<TicketFlow[]> | null>(null);

	const authHeaders = (): Record<string, string> => bearerHeaders(authStore.sessionToken);

	const fetch = async (force: boolean = false): Promise<TicketFlow[]> => {
		if (fetchPromise.value) return fetchPromise.value;
		if (flows.value.length && !force) return flows.value;

		fetchPromise.value = (async () => {
			try {
				const result = await requestFetch<TicketFlow[]>(`/api/flows`, {
					cache: 'no-store',
					credentials: 'include',
					headers: authHeaders()
				});
				flows.value = result;
				return result;
			} catch (error) {
				console.error('Failed to fetch flows:', error);
				return flows.value;
			} finally {
				fetchPromise.value = null;
			}
		})();

		return fetchPromise.value;
	};

	const create = async (body: FlowInput): Promise<TicketFlow> => {
		try {
			const flow = await requestFetch<TicketFlow>(`/api/flows`, {
				method: 'POST',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			flows.value = [...flows.value, flow];
			return flow;
		} catch (error) {
			console.error('Failed to create flow:', error);
			throw error;
		}
	};

	const update = async (id: number, body: Partial<FlowInput>): Promise<TicketFlow> => {
		try {
			const flow = await requestFetch<TicketFlow>(`/api/flows/${id}`, {
				method: 'PATCH',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			flows.value = flows.value.map((f) => (f.id === id ? flow : f));
			return flow;
		} catch (error) {
			console.error(`Failed to update flow "${id}":`, error);
			throw error;
		}
	};

	const remove = async (id: number): Promise<void> => {
		try {
			await requestFetch(`/api/flows/${id}`, {
				method: 'DELETE',
				credentials: 'include',
				headers: authHeaders()
			});
			flows.value = flows.value.filter((f) => f.id !== id);
		} catch (error) {
			console.error(`Failed to delete flow "${id}":`, error);
			throw error;
		}
	};

	return {
		flows,
		fetch,
		create,
		update,
		remove
	};
});
