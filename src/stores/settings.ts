import { defineStore } from 'pinia';
import { useAuthStore } from '~/stores/auth';

export type Settings = Record<string, any>;

export const useSettingsStore = defineStore('settings', () => {
	const authStore = useAuthStore();

	const settings = ref<Settings | null>(null);
	const fetchPromise = ref<Promise<Settings | null> | null>(null);

	const authHeaders = (): Record<string, string> => {
		const token = authStore.sessionToken;
		return token ? { Authorization: `Bearer ${token}` } : {};
	};

	const fetch = async (force: boolean = false): Promise<Settings | null> => {
		if (fetchPromise.value) return fetchPromise.value;
		if (settings.value && !force) return settings.value;

		fetchPromise.value = (async () => {
			try {
				const result = await $fetch<Settings>(`/api/settings`, {
					cache: 'no-store',
					credentials: 'include'
				});
				settings.value = result;
				return result;
			} catch (error) {
				console.error('Failed to fetch settings:', error);
				return settings.value;
			} finally {
				fetchPromise.value = null;
			}
		})();

		return fetchPromise.value;
	};

	const save = async (partial: Partial<Settings>): Promise<Settings> => {
		try {
			const result = await $fetch<Settings>(`/api/settings`, {
				method: 'POST',
				body: partial,
				credentials: 'include',
				headers: authHeaders()
			});
			settings.value = result;
			return result;
		} catch (error) {
			console.error('Failed to save settings:', error);
			throw error;
		}
	};

	const sendTestEmail = async (to: string) => {
		try {
			return await $fetch(`/api/settings/test-email`, {
				method: 'POST',
				body: { to },
				credentials: 'include',
				headers: authHeaders()
			});
		} catch (error) {
			console.error('Failed to send test email:', error);
			throw error;
		}
	};

	return {
		settings,
		fetch,
		save,
		sendTestEmail
	};
});
