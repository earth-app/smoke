import { useCloudflareStore } from '~/stores/cloudflare';

export function useCloudflare() {
	const cloudflareStore = useCloudflareStore();

	const status = computed(() => cloudflareStore.status);
	const isLinked = computed(() => !!cloudflareStore.status?.linked);

	const fetchStatus = async (force: boolean = false) => {
		return await cloudflareStore.fetchStatus(force);
	};

	const link = async (body: { account_id: string; token: string }) => {
		return await cloudflareStore.link(body);
	};

	const provision = async (body: { zone_id: string; worker_name?: string }) => {
		return await cloudflareStore.provision(body);
	};

	const unlink = async () => {
		return await cloudflareStore.unlink();
	};

	// load status state
	fetchStatus();

	return {
		status,
		isLinked,
		fetchStatus,
		link,
		provision,
		unlink
	};
}
