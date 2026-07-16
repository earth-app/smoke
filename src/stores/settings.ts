import { defineStore } from 'pinia';
import { useAuthStore } from '~/stores/auth';

export type Settings = Record<string, any>;

export const useSettingsStore = defineStore('settings', () => {
	const authStore = useAuthStore();
	// request-scoped so the ssr fetch routes IN-PROCESS; a bare $fetch to a relative url loops back
	// to the worker's own origin during ssr and stalls (same failure as the auth store)
	const requestFetch = useRequestFetch();

	// three-state: undefined = not loaded yet (show a skeleton), null = load failed, object = loaded
	const settings = ref<Settings | null | undefined>(undefined);
	const fetchPromise = ref<Promise<Settings | null> | null>(null);

	const loaded = computed(() => settings.value !== undefined);

	const authHeaders = (): Record<string, string> => bearerHeaders(authStore.sessionToken);

	const fetch = async (force: boolean = false): Promise<Settings | null> => {
		if (fetchPromise.value) return fetchPromise.value;
		if (settings.value !== undefined && !force) return settings.value;

		fetchPromise.value = (async () => {
			try {
				const result = await requestFetch<Settings>(`/api/settings`, {
					cache: 'no-store',
					credentials: 'include'
				});
				settings.value = result;
				return result;
			} catch (error) {
				console.error('Failed to fetch settings:', error);
				// resolve the loading state so consumers stop showing a skeleton on a failed load
				if (settings.value === undefined) settings.value = null;
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

	// merge a partial email config into the persisted one so independent cards (outbound smtp,
	// inbound poll) never clobber each other; the server replaces the whole email blob on save
	const saveEmail = async (partial: Record<string, any>): Promise<Settings> => {
		const merged = mergeEmailSettings(settings.value?.email as Record<string, any>, partial);
		return await save({ email: merged });
	};

	return {
		settings,
		loaded,
		fetch,
		save,
		saveEmail,
		sendTestEmail
	};
});
