import { defineStore } from 'pinia';
import { useAuthStore } from '~/stores/auth';

export type CloudflareZone = { id: string; name: string };
export type CloudflareWorker = { name: string };

export type CloudflareStatus = {
	linked: boolean;
	account_id?: string;
	zone_id?: string;
	worker_name?: string;
	provisioned?: boolean;
	zones?: CloudflareZone[];
	checklist?: Record<string, boolean>;
	[key: string]: any;
};

export type CloudflareProvisionStep = { name: string; ok: boolean; detail?: string };
export type CloudflareProvisionResult = { steps: CloudflareProvisionStep[]; [key: string]: any };

export type CloudflareProvisionInput = {
	zone_id: string;
	worker_name?: string;
	support_email?: string;
	// inline creds are only sent during first-run setup (no sealed token yet)
	token?: string;
	account_id?: string;
};

export const useCloudflareStore = defineStore('cloudflare', () => {
	const authStore = useAuthStore();

	const status = ref<CloudflareStatus | null>(null);
	const statusPromise = ref<Promise<CloudflareStatus | null> | null>(null);
	const workers = ref<CloudflareWorker[]>([]);
	const workersPromise = ref<Promise<CloudflareWorker[]> | null>(null);

	const zones = computed<CloudflareZone[]>(() => status.value?.zones ?? []);

	const authHeaders = (): Record<string, string> => {
		const token = authStore.sessionToken;
		return token ? { Authorization: `Bearer ${token}` } : {};
	};

	const fetchStatus = async (force: boolean = false): Promise<CloudflareStatus | null> => {
		if (statusPromise.value) return statusPromise.value;
		if (status.value && !force) return status.value;
		// status is auth-only; skip the guaranteed 401 when signed out (e.g. the setup wizard)
		if (!authStore.sessionToken) return status.value;

		statusPromise.value = (async () => {
			try {
				const result = await $fetch<CloudflareStatus>(`/api/cloudflare/status`, {
					cache: 'no-store',
					credentials: 'include',
					headers: authHeaders()
				});
				status.value = result;
				return result;
			} catch (error) {
				console.error('Failed to fetch Cloudflare status:', error);
				return status.value;
			} finally {
				statusPromise.value = null;
			}
		})();

		return statusPromise.value;
	};

	// worker scripts on the linked account; first-run allowed so the setup wizard can list them
	const fetchWorkers = async (force: boolean = false): Promise<CloudflareWorker[]> => {
		if (workersPromise.value) return workersPromise.value;
		if (workers.value.length && !force) return workers.value;

		workersPromise.value = (async () => {
			try {
				const result = await $fetch<{ workers: CloudflareWorker[] }>(`/api/cloudflare/workers`, {
					cache: 'no-store',
					credentials: 'include',
					headers: authHeaders()
				});
				workers.value = result?.workers ?? [];
				return workers.value;
			} catch (error) {
				console.error('Failed to fetch Cloudflare workers:', error);
				return workers.value;
			} finally {
				workersPromise.value = null;
			}
		})();

		return workersPromise.value;
	};

	const link = async (body: { account_id: string; token: string }): Promise<CloudflareStatus> => {
		try {
			const result = await $fetch<CloudflareStatus>(`/api/cloudflare/link`, {
				method: 'POST',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			status.value = result;
			return result;
		} catch (error) {
			console.error('Failed to link Cloudflare account:', error);
			throw error;
		}
	};

	const provision = async (body: CloudflareProvisionInput): Promise<CloudflareProvisionResult> => {
		try {
			const result = await $fetch<CloudflareProvisionResult>(`/api/cloudflare/provision`, {
				method: 'POST',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			// provision returns per-step results, not a status; refresh the read-back separately
			await fetchStatus(true);
			return result;
		} catch (error) {
			console.error('Failed to provision Cloudflare worker:', error);
			throw error;
		}
	};

	const unlink = async (): Promise<void> => {
		try {
			await $fetch(`/api/cloudflare/unlink`, {
				method: 'DELETE',
				credentials: 'include',
				headers: authHeaders()
			});
			status.value = null;
			workers.value = [];
		} catch (error) {
			console.error('Failed to unlink Cloudflare account:', error);
			throw error;
		}
	};

	return {
		status,
		zones,
		workers,
		fetchStatus,
		fetchWorkers,
		link,
		provision,
		unlink
	};
});
