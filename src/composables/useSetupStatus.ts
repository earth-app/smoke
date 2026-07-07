type SetupStatus = {
	needsSetup: boolean;
	[key: string]: any;
};

export function useSetupStatus() {
	const status = useState<SetupStatus | null>('smoke:setup-status', () => null);

	const refresh = async () => {
		try {
			status.value = await $fetch<SetupStatus>('/api/setup/status', {
				credentials: 'include'
			});
		} catch {
			// keep any previously-known status; nulling it would loop the setup middleware
		}
		return status.value;
	};

	const ensure = async () => {
		if (status.value) return status.value;
		return refresh();
	};

	return { status, refresh, ensure };
}
