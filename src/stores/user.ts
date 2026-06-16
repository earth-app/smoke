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
