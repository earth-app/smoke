import { defineStore } from 'pinia';
import { type User } from '~/shared/types/user';

export const useUserStore = defineStore('user', () => {
	// request-scoped so internal api reads route in-process during ssr (avoids the self-loopback stall)
	const requestFetch = useRequestFetch();
	const authStore = useAuthStore();
	const cache = reactive(new Map<string, User>());
	const avatars = reactive(new Map<string, Blob>());

	const get = (identifier: string): User | undefined => {
		return cache.get(identifier);
	};

	const set = (user: User) => {
		cache.set(user.id, user);
		if (user.username) {
			cache.set(user.username, user);
		}
	};

	const has = (identifier: string): boolean => {
		return cache.has(identifier);
	};

	const createUser = async (payload: { username: string; email: string }) => {
		try {
			const user = await requestFetch<User>(`/api/users`, {
				method: 'POST',
				body: payload,
				credentials: 'include'
			});
			set(user);
			return user;
		} catch (error) {
			console.error('Failed to create user:', error);
			throw error;
		}
	};

	const listUsers = async (options?: QueryParameters) => {
		try {
			const params = toSearchParams(options);
			const users = await requestFetch<User[]>(`/api/users?${params.toString()}`, {
				cache: 'no-store',
				credentials: 'include'
			});
			users.forEach(set);
			return users;
		} catch (error) {
			console.error('Failed to list users:', error);
			return [];
		}
	};

	const fetchUser = async (identifier: string, force: boolean = false): Promise<User | null> => {
		if (!force && cache.has(identifier)) {
			return cache.get(identifier) || null;
		}

		try {
			const user = await requestFetch<User>(`/api/users/${encodeURIComponent(identifier)}`, {
				cache: 'no-store',
				credentials: 'include'
			});
			set(user);
			return user;
		} catch (error) {
			console.error(`Failed to fetch user with identifier "${identifier}":`, error);
			return null;
		}
	};

	const updateUser = async (payload: Partial<User> & { id: string }) => {
		try {
			const updatedUser = await requestFetch<User>(`/api/users/${encodeURIComponent(payload.id)}`, {
				method: 'PATCH',
				body: payload,
				credentials: 'include'
			});
			set(updatedUser);
			return updatedUser;
		} catch (error) {
			console.error(`Failed to update user with ID "${payload.id}":`, error);
			throw error;
		}
	};

	const deleteUser = async (id: string) => {
		try {
			await requestFetch(`/api/users/${encodeURIComponent(id)}`, {
				method: 'DELETE',
				credentials: 'include'
			});
			cache.delete(id);
		} catch (error) {
			console.error(`Failed to delete user with ID "${id}":`, error);
			throw error;
		}
	};

	const getAvatar = async (userId: string): Promise<Blob | null> => {
		if (avatars.has(userId)) {
			return avatars.get(userId) || null;
		}

		try {
			const response = await requestFetch<Blob>(`/api/users/${encodeURIComponent(userId)}/avatar`, {
				cache: 'no-store',
				credentials: 'include',
				responseType: 'blob'
			});
			avatars.set(userId, response);
			return response;
		} catch (error) {
			console.error(`Failed to fetch avatar for user ID "${userId}":`, error);
			return null;
		}
	};

	const setAvatar = async (
		userId: string,
		avatar: File | Blob | ArrayBuffer | string | { icon: string }
	) => {
		try {
			const body = resolveAvatarBody(avatar);

			// the endpoint returns the updated user, not the image blob
			const updatedUser = await requestFetch<User>(
				`/api/users/${encodeURIComponent(userId)}/avatar`,
				{
					method: 'POST',
					body,
					credentials: 'include',
					// avatar.post is Bearer-gated (ensureLoggedIn); the cookie alone 401s
					headers: bearerHeaders(authStore.sessionToken)
				}
			);

			set(updatedUser);

			// drop the cached image so the next getAvatar fetches the new one
			avatars.delete(userId);
			return updatedUser;
		} catch (error) {
			console.error(`Failed to set avatar for user ID "${userId}":`, error);
			throw error;
		}
	};

	return {
		cache,
		avatars,
		get,
		set,
		has,
		createUser,
		listUsers,
		fetchUser,
		updateUser,
		deleteUser,
		getAvatar,
		setAvatar
	};
});

export const useCustomerStore = defineStore('customer', () => {
	// request-scoped so internal api reads route in-process during ssr (avoids the self-loopback stall)
	const requestFetch = useRequestFetch();
	const authStore = useAuthStore();

	const cache = reactive(new Map<number, Customer>());
	const listInFlight = reactive(new Map<string, Promise<Customer[]>>());
	const getInFlight = reactive(new Map<number, Promise<Customer | null>>());

	const authHeaders = (): Record<string, string> => bearerHeaders(authStore.sessionToken);

	const set = (customer: Customer) => {
		cache.set(customer.id, customer);
	};

	const get = (id: number): Customer | undefined => cache.get(id);

	const listCustomers = async (options?: QueryParameters): Promise<Customer[]> => {
		const params = toSearchParams(options);
		const key = params.toString();

		const existing = listInFlight.get(key);
		if (existing) return existing;

		const promise = (async () => {
			try {
				const customers = await requestFetch<Customer[]>(`/api/customers?${key}`, {
					cache: 'no-store',
					credentials: 'include',
					headers: authHeaders()
				});
				customers.forEach(set);
				return customers;
			} catch (error) {
				console.error('Failed to list customers:', error);
				return [];
			} finally {
				listInFlight.delete(key);
			}
		})();

		listInFlight.set(key, promise);
		return promise;
	};

	const fetchCustomer = async (id: number, force: boolean = false): Promise<Customer | null> => {
		if (!force && cache.has(id)) return cache.get(id) || null;

		const existing = getInFlight.get(id);
		if (existing) return existing;

		const promise = (async () => {
			try {
				const customer = await requestFetch<Customer>(`/api/customers/${id}`, {
					cache: 'no-store',
					credentials: 'include',
					headers: authHeaders()
				});
				set(customer);
				return customer;
			} catch (error) {
				console.error(`Failed to fetch customer "${id}":`, error);
				return null;
			} finally {
				getInFlight.delete(id);
			}
		})();

		getInFlight.set(id, promise);
		return promise;
	};

	const createCustomer = async (body: Partial<Customer>): Promise<Customer> => {
		try {
			const customer = await requestFetch<Customer>(`/api/customers`, {
				method: 'POST',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			set(customer);
			return customer;
		} catch (error) {
			console.error('Failed to create customer:', error);
			throw error;
		}
	};

	const patchCustomer = async (id: number, body: Partial<Customer>): Promise<Customer> => {
		try {
			const customer = await requestFetch<Customer>(`/api/customers/${id}`, {
				method: 'PATCH',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			set(customer);
			return customer;
		} catch (error) {
			console.error(`Failed to patch customer "${id}":`, error);
			throw error;
		}
	};

	const deleteCustomer = async (id: number): Promise<void> => {
		try {
			await requestFetch(`/api/customers/${id}`, {
				method: 'DELETE',
				credentials: 'include',
				headers: authHeaders()
			});
			cache.delete(id);
		} catch (error) {
			console.error(`Failed to delete customer "${id}":`, error);
			throw error;
		}
	};

	// mint a portal magic-link for a customer; returns the shareable url
	const customerMagicLink = async (id: number): Promise<string> => {
		const { url } = await requestFetch<{ url: string; token: string }>(
			`/api/customers/${id}/magic-link`,
			{
				method: 'POST',
				credentials: 'include',
				headers: authHeaders()
			}
		);
		return url;
	};

	return {
		cache,
		get,
		set,
		listCustomers,
		fetchCustomer,
		createCustomer,
		patchCustomer,
		deleteCustomer,
		customerMagicLink
	};
});

export const useCustomerPortalStore = defineStore('customer-portal', () => {
	// request-scoped so internal api reads route in-process during ssr (avoids the self-loopback stall)
	const requestFetch = useRequestFetch();
	// undefined = not yet loaded, null = signed out, Customer = signed in
	const customer = ref<Customer | null | undefined>(undefined);
	const isLoading = ref(false);
	const fetchPromise = ref<Promise<Customer | null> | null>(null);

	const isCustomer = computed(() => !!customer.value);

	// the session cookie is httpOnly and isn't forwarded to internal ssr fetches, so hydrate
	// on the client only; a server fetch would cache a false null and block the real client fetch
	const fetchCustomer = async (force: boolean = false): Promise<Customer | null> => {
		if (import.meta.server) return null;
		if (fetchPromise.value) return fetchPromise.value;
		if (customer.value !== undefined && !force) return customer.value;

		isLoading.value = true;
		fetchPromise.value = (async () => {
			try {
				const response = await requestFetch<{ customer: Customer | null }>('/api/portal/me', {
					cache: 'no-store',
					credentials: 'include'
				});
				customer.value = response.customer ?? null;
				return customer.value;
			} catch (error) {
				console.error('Failed to fetch customer:', error);
				customer.value = null;
				return null;
			} finally {
				isLoading.value = false;
				fetchPromise.value = null;
			}
		})();

		return fetchPromise.value;
	};

	const requestOtp = async (email: string, turnstile?: string): Promise<void> => {
		await requestFetch('/api/portal/request-otp', {
			method: 'POST',
			body: { email, ...(turnstile ? { turnstile } : {}) },
			credentials: 'include'
		});
	};

	const verifyOtp = async (email: string, code: string): Promise<Customer> => {
		const response = await requestFetch<{ customer: Customer }>('/api/portal/verify-otp', {
			method: 'POST',
			body: { email, code },
			credentials: 'include'
		});
		customer.value = response.customer;
		return response.customer;
	};

	const logout = async (): Promise<void> => {
		try {
			await requestFetch('/api/portal/logout', { method: 'POST', credentials: 'include' });
		} catch (error) {
			console.error('Customer logout failed:', error);
		} finally {
			customer.value = null;
		}
	};

	return { customer, isLoading, isCustomer, fetchCustomer, requestOtp, verifyOtp, logout };
});
