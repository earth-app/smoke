import { defineStore } from 'pinia';
import { useAuthStore } from '~/stores/auth';

export type CloudflareStatus = {
	linked: boolean;
	account_id?: string;
	zone_id?: string;
	worker_name?: string;
	provisioned?: boolean;
	[key: string]: any;
};

export const useCloudflareStore = defineStore('cloudflare', () => {
	const authStore = useAuthStore();

	const status = ref<CloudflareStatus | null>(null);
	const statusPromise = ref<Promise<CloudflareStatus | null> | null>(null);

	const authHeaders = (): Record<string, string> => {
		const token = authStore.sessionToken;
		return token ? { Authorization: `Bearer ${token}` } : {};
	};

	const fetchStatus = async (force: boolean = false): Promise<CloudflareStatus | null> => {
		if (statusPromise.value) return statusPromise.value;
		if (status.value && !force) return status.value;

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

	const provision = async (body: {
		zone_id: string;
		worker_name?: string;
	}): Promise<CloudflareStatus> => {
		try {
			const result = await $fetch<CloudflareStatus>(`/api/cloudflare/provision`, {
				method: 'POST',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			status.value = result;
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
		} catch (error) {
			console.error('Failed to unlink Cloudflare account:', error);
			throw error;
		}
	};

	return {
		status,
		fetchStatus,
		link,
		provision,
		unlink
	};
});
