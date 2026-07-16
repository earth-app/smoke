type SetupStatus = {
	needsSetup: boolean;
	[key: string]: any;
};

export function useSetupStatus() {
	const status = useState<SetupStatus | null>('smoke:setup-status', () => null);
	const request = useRequestFetch();

	const refresh = async () => {
		try {
			status.value = await request<SetupStatus>('/api/setup/status', {
				credentials: 'include'
			});
		} catch {
			// leave the status unknown
		}
		return status.value;
	};

	const ensure = async () => {
		if (status.value) return status.value;
		return refresh();
	};

	return { status, refresh, ensure };
}
