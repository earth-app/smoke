import type { Ticket, TicketCreateInput, TicketPatchInput } from '~/shared/types/ticket';
import { useTicketStore } from '~/stores/ticket';

type ReplyBody = {
	message: string;
	reply_to?: number;
	attachments?: unknown[];
	identity?: 'self' | 'team';
};

// single ticket + its thread + reply
export function useTicket(id: MaybeRefOrGetter<number>) {
	const ticketsStore = useTicketStore();
	const currentId = computed(() => toValue(id));

	const ticket = computed(() => ticketsStore.get(currentId.value));
	const thread = computed(() => ticketsStore.threads.get(currentId.value) || null);
	const messages = computed(() => thread.value?.messages || []);

	const fetchTicket = async (force: boolean = false) => {
		return await ticketsStore.fetchTicket(currentId.value, force);
	};

	const fetchThread = async (force: boolean = false) => {
		return await ticketsStore.fetchThread(currentId.value, force);
	};

	const patchTicket = async (body: TicketPatchInput) => {
		return await ticketsStore.patchTicket(currentId.value, body);
	};

	const deleteTicket = async () => {
		return await ticketsStore.deleteTicket(currentId.value);
	};

	const reply = async (body: ReplyBody) => {
		return await ticketsStore.postMessage(currentId.value, body);
	};

	// load ticket + thread
	fetchTicket();
	fetchThread();
	watch(currentId, (newId, oldId) => {
		if (newId !== oldId) {
			fetchTicket();
			fetchThread();
		}
	});

	return {
		ticket,
		thread,
		messages,
		fetchTicket,
		fetchThread,
		patchTicket,
		deleteTicket,
		reply
	};
}

// ticket list (search/filter/paginate)
export function useTickets(options?: MaybeRefOrGetter<QueryParameters | undefined>) {
	const ticketsStore = useTicketStore();

	const tickets = ref<Ticket[]>([]);
	const pending = ref(false);

	const listTickets = async (override?: QueryParameters): Promise<Ticket[]> => {
		pending.value = true;
		try {
			const query = override ?? toValue(options);
			const result = await ticketsStore.listTickets(query);
			tickets.value = result;
			return result;
		} finally {
			pending.value = false;
		}
	};

	const createTicket = async (body: TicketCreateInput) => {
		return await ticketsStore.createTicket(body);
	};

	const deleteTicket = async (id: number) => {
		await ticketsStore.deleteTicket(id);
		tickets.value = tickets.value.filter((t) => t.id !== id);
	};

	if (options !== undefined) {
		listTickets();
		watch(
			() => toValue(options),
			() => listTickets(),
			{ deep: true }
		);
	}

	return {
		tickets,
		pending,
		listTickets,
		createTicket,
		deleteTicket
	};
}
