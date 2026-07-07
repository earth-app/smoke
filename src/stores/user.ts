import { defineStore } from 'pinia';
import { type User } from '~/shared/types/user';

export const useUserStore = defineStore('user', () => {
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
			const user = await $fetch<User>(`/api/users`, {
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
			const users = await $fetch<User[]>(`/api/users?${params.toString()}`, {
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
			const user = await $fetch<User>(`/api/users/${encodeURIComponent(identifier)}`, {
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
			const updatedUser = await $fetch<User>(`/api/users/${encodeURIComponent(payload.id)}`, {
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
			await $fetch(`/api/users/${encodeURIComponent(id)}`, {
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
			const response = await $fetch<Blob>(`/api/users/${encodeURIComponent(userId)}/avatar`, {
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

	const setAvatar = async (userId: string, avatar: File | Blob | ArrayBuffer | string) => {
		try {
			let body: FormData | { url: string } | { base64: string } | null = null;

			// file, blob, array buffer -> multipart form data
			if (avatar instanceof File || avatar instanceof Blob) {
				body = new FormData();
				body.append('avatar', avatar);
			}

			if (avatar instanceof ArrayBuffer) {
				body = new FormData();
				body.append('avatar', new Blob([avatar]));
			}

			// string -> url or base64
			if (typeof avatar === 'string') {
				// disallow http urls for security reasons, only allow https or data uris
				if (avatar.startsWith('https://')) {
					body = { url: avatar };
				} else if (avatar.startsWith('data:image/')) {
					body = { base64: avatar };
				} else {
					throw new Error('Invalid avatar string format');
				}
			}

			// the endpoint returns the updated user, not the image blob
			const updatedUser = await $fetch<User>(`/api/users/${encodeURIComponent(userId)}/avatar`, {
				method: 'POST',
				body,
				credentials: 'include'
			});

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
	const authStore = useAuthStore();

	const cache = reactive(new Map<number, Customer>());
	const listInFlight = reactive(new Map<string, Promise<Customer[]>>());
	const getInFlight = reactive(new Map<number, Promise<Customer | null>>());

	const authHeaders = (): Record<string, string> => {
		const token = authStore.sessionToken;
		return token ? { Authorization: `Bearer ${token}` } : {};
	};

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
				const customers = await $fetch<Customer[]>(`/api/customers?${key}`, {
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
				const customer = await $fetch<Customer>(`/api/customers/${id}`, {
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
			const customer = await $fetch<Customer>(`/api/customers`, {
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
			const customer = await $fetch<Customer>(`/api/customers/${id}`, {
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
			await $fetch(`/api/customers/${id}`, {
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

	return {
		cache,
		get,
		set,
		listCustomers,
		fetchCustomer,
		createCustomer,
		patchCustomer,
		deleteCustomer
	};
});
