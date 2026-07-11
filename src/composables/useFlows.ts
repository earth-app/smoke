import type { TicketFlow } from '~/shared/types/ticket';
import type { FlowInput } from '~/stores/flows';
import { useFlowsStore } from '~/stores/flows';

export function useFlows() {
	const flowsStore = useFlowsStore();

	const flows = computed(() => flowsStore.flows);

	const fetchFlows = async (force: boolean = false): Promise<TicketFlow[]> => {
		return await flowsStore.fetch(force);
	};

	const createFlow = async (body: FlowInput): Promise<TicketFlow> => {
		return await flowsStore.create(body);
	};

	const updateFlow = async (id: number, body: Partial<FlowInput>): Promise<TicketFlow> => {
		return await flowsStore.update(id, body);
	};

	const deleteFlow = async (id: number): Promise<void> => {
		return await flowsStore.remove(id);
	};

	// load flows state
	fetchFlows();

	return {
		flows,
		fetchFlows,
		createFlow,
		updateFlow,
		deleteFlow
	};
}
