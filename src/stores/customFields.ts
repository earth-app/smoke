import { defineStore } from 'pinia';
import type { CustomFieldDef } from '~/shared/types/ticket';
import { useAuthStore } from '~/stores/auth';

export const useCustomFieldsStore = defineStore('customFields', () => {
	const authStore = useAuthStore();

	const fields = ref<CustomFieldDef[]>([]);
	const loaded = ref(false);
	const fetchPromise = ref<Promise<CustomFieldDef[]> | null>(null);

	const authHeaders = (): Record<string, string> => {
		const token = authStore.sessionToken;
		return token ? { Authorization: `Bearer ${token}` } : {};
	};

	const fetch = async (force: boolean = false): Promise<CustomFieldDef[]> => {
		if (fetchPromise.value) return fetchPromise.value;
		if (loaded.value && !force) return fields.value;

		fetchPromise.value = (async () => {
			try {
				const result = await $fetch<CustomFieldDef[]>(`/api/custom-fields`, {
					cache: 'no-store',
					credentials: 'include',
					headers: authHeaders()
				});
				fields.value = result;
				loaded.value = true;
				return result;
			} catch (error) {
				console.error('Failed to fetch custom fields:', error);
				return fields.value;
			} finally {
				fetchPromise.value = null;
			}
		})();

		return fetchPromise.value;
	};

	const save = async (defs: CustomFieldDef[]): Promise<CustomFieldDef[]> => {
		try {
			const result = await $fetch<CustomFieldDef[]>(`/api/custom-fields`, {
				method: 'POST',
				body: { fields: defs },
				credentials: 'include',
				headers: authHeaders()
			});
			fields.value = result;
			loaded.value = true;
			return result;
		} catch (error) {
			console.error('Failed to save custom fields:', error);
			throw error;
		}
	};

	return { fields, fetch, save };
});
