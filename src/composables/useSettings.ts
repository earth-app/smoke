import type { Settings } from '~/stores/settings';
import { useSettingsStore } from '~/stores/settings';

export function useSettings() {
	const settingsStore = useSettingsStore();

	const settings = computed(() => settingsStore.settings);
	// undefined = still loading (show a skeleton), null = load failed, object = loaded
	const loaded = computed(() => settingsStore.loaded);

	const fetchSettings = async (force: boolean = false) => {
		return await settingsStore.fetch(force);
	};

	const save = async (partial: Partial<Settings>) => {
		return await settingsStore.save(partial);
	};

	const saveEmail = async (partial: Record<string, any>) => {
		return await settingsStore.saveEmail(partial);
	};

	const sendTestEmail = async (to: string) => {
		return await settingsStore.sendTestEmail(to);
	};

	// load settings state
	fetchSettings();

	return {
		settings,
		loaded,
		fetchSettings,
		save,
		saveEmail,
		sendTestEmail
	};
}
