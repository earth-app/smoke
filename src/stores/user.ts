import { defineStore } from 'pinia';
import { type User } from '~/shared/types/user';

export const useUserStore = defineStore('user', () => {
	const cache = reactive(new Map<string, User>());

	const get = (identifier: string): User | undefined => {
		return cache.get(identifier);
	};

	const has = (identifier: string): boolean => {
		return cache.has(identifier);
	};

	return {
		cache,
		get,
		has
	};
});
