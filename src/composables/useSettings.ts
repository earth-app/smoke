import type { Settings } from '~/stores/settings';
import { useSettingsStore } from '~/stores/settings';

export function useSettings() {
	const settingsStore = useSettingsStore();

	const settings = computed(() => settingsStore.settings);

	const fetchSettings = async (force: boolean = false) => {
		return await settingsStore.fetch(force);
	};

	const save = async (partial: Partial<Settings>) => {
		return await settingsStore.save(partial);
	};

	const sendTestEmail = async (to: string) => {
		return await settingsStore.sendTestEmail(to);
	};

	// load settings state
	fetchSettings();

	return {
		settings,
		fetchSettings,
		save,
		sendTestEmail
	};
}
