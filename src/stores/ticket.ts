import { defineStore } from 'pinia';
import type {
	Ticket,
	TicketCreateInput,
	TicketMessage,
	TicketPatchInput,
	TicketThread
} from '~/shared/types/ticket';
import { useAuthStore } from '~/stores/auth';

type PostMessageBody = {
	message: string;
	reply_to?: number;
	attachments?: unknown[];
	identity?: 'self' | 'team';
};

export const useTicketStore = defineStore('ticket', () => {
	const authStore = useAuthStore();

	const cache = reactive(new Map<number, Ticket>());
	const threads = reactive(new Map<number, TicketThread>());

	const listInFlight = reactive(new Map<string, Promise<Ticket[]>>());
	const getInFlight = reactive(new Map<number, Promise<Ticket | null>>());
	const threadInFlight = reactive(new Map<number, Promise<TicketThread | null>>());

	const authHeaders = (): Record<string, string> => {
		const token = authStore.sessionToken;
		return token ? { Authorization: `Bearer ${token}` } : {};
	};

	const set = (ticket: Ticket) => {
		cache.set(ticket.id, ticket);
	};

	const get = (id: number): Ticket | undefined => cache.get(id);

	const listTickets = async (options?: QueryParameters): Promise<Ticket[]> => {
		const params = toSearchParams(options);
		const key = params.toString();

		const existing = listInFlight.get(key);
		if (existing) return existing;

		const promise = (async () => {
			try {
				const tickets = await $fetch<Ticket[]>(`/api/tickets?${key}`, {
					cache: 'no-store',
					credentials: 'include',
					headers: authHeaders()
				});
				tickets.forEach(set);
				return tickets;
			} catch (error) {
				console.error('Failed to list tickets:', error);
				return [];
			} finally {
				listInFlight.delete(key);
			}
		})();

		listInFlight.set(key, promise);
		return promise;
	};

	const fetchTicket = async (id: number, force: boolean = false): Promise<Ticket | null> => {
		if (!force && cache.has(id)) return cache.get(id) || null;

		const existing = getInFlight.get(id);
		if (existing) return existing;

		const promise = (async () => {
			try {
				const ticket = await $fetch<Ticket>(`/api/tickets/${id}`, {
					cache: 'no-store',
					credentials: 'include',
					headers: authHeaders()
				});
				set(ticket);
				return ticket;
			} catch (error) {
				console.error(`Failed to fetch ticket "${id}":`, error);
				return null;
			} finally {
				getInFlight.delete(id);
			}
		})();

		getInFlight.set(id, promise);
		return promise;
	};

	const fetchThread = async (id: number, force: boolean = false): Promise<TicketThread | null> => {
		if (!force && threads.has(id)) return threads.get(id) || null;

		const existing = threadInFlight.get(id);
		if (existing) return existing;

		const promise = (async () => {
			try {
				// the api exposes the ticket and its messages separately; assemble the thread here
				const [ticket, messages] = await Promise.all([
					$fetch<Ticket>(`/api/tickets/${id}`, {
						cache: 'no-store',
						credentials: 'include',
						headers: authHeaders()
					}),
					$fetch<TicketMessage[]>(`/api/tickets/${id}/messages`, {
						cache: 'no-store',
						credentials: 'include',
						headers: authHeaders()
					})
				]);

				set(ticket);

				// derive the distinct participants from message senders
				const seen = new Set<string>();
				const users: TicketThread['users'] = [];
				for (const message of messages) {
					const key = `${message.sender.kind}:${message.sender.id}`;
					if (seen.has(key)) continue;
					seen.add(key);
					users.push(message.sender);
				}

				const thread: TicketThread = { ticket, messages, users };
				threads.set(id, thread);
				return thread;
			} catch (error) {
				console.error(`Failed to fetch thread for ticket "${id}":`, error);
				return null;
			} finally {
				threadInFlight.delete(id);
			}
		})();

		threadInFlight.set(id, promise);
		return promise;
	};

	const createTicket = async (body: TicketCreateInput): Promise<Ticket> => {
		try {
			const ticket = await $fetch<Ticket>(`/api/tickets`, {
				method: 'POST',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			set(ticket);
			return ticket;
		} catch (error) {
			console.error('Failed to create ticket:', error);
			throw error;
		}
	};

	const patchTicket = async (id: number, body: TicketPatchInput): Promise<Ticket> => {
		try {
			const ticket = await $fetch<Ticket>(`/api/tickets/${id}`, {
				method: 'PATCH',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			set(ticket);
			return ticket;
		} catch (error) {
			console.error(`Failed to patch ticket "${id}":`, error);
			throw error;
		}
	};

	const deleteTicket = async (id: number): Promise<void> => {
		try {
			await $fetch(`/api/tickets/${id}`, {
				method: 'DELETE',
				credentials: 'include',
				headers: authHeaders()
			});
			cache.delete(id);
			threads.delete(id);
		} catch (error) {
			console.error(`Failed to delete ticket "${id}":`, error);
			throw error;
		}
	};

	const postMessage = async (id: number, body: PostMessageBody) => {
		try {
			const result = await $fetch(`/api/tickets/${id}/messages`, {
				method: 'POST',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			// refresh the thread so the new message shows up
			await fetchThread(id, true);
			return result;
		} catch (error) {
			console.error(`Failed to post message to ticket "${id}":`, error);
			throw error;
		}
	};

	return {
		cache,
		threads,
		get,
		set,
		listTickets,
		fetchTicket,
		fetchThread,
		createTicket,
		patchTicket,
		deleteTicket,
		postMessage
	};
});
