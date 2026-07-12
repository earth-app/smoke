import type { CloudflareProvisionInput } from '~/stores/cloudflare';
import { useCloudflareStore } from '~/stores/cloudflare';

export function useCloudflare() {
	const cloudflareStore = useCloudflareStore();

	const status = computed(() => cloudflareStore.status);
	const isLinked = computed(() => !!cloudflareStore.status?.linked);
	const zones = computed(() => cloudflareStore.zones);
	const workers = computed(() => cloudflareStore.workers);

	const fetchStatus = async (force: boolean = false) => {
		return await cloudflareStore.fetchStatus(force);
	};

	const fetchWorkers = async (force: boolean = false) => {
		return await cloudflareStore.fetchWorkers(force);
	};

	const link = async (body: { account_id: string; token: string }) => {
		return await cloudflareStore.link(body);
	};

	const provision = async (body: CloudflareProvisionInput) => {
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
		zones,
		workers,
		fetchStatus,
		fetchWorkers,
		link,
		provision,
		unlink
	};
}
