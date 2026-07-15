import { defineStore } from 'pinia';
import { useAuthStore } from '~/stores/auth';
import type { AuditQuery } from '~/utils/audit-query';

export type { AuditQuery };

export type AuditEntry = {
	id: number;
	created_at: number;
	action: string;
	actor_id: string | null;
	actor_name: string | null;
	target_type: string | null;
	target_id: string | null;
	ticket_id: number | null;
	priority: string | null;
	summary: string | null;
	context: Record<string, unknown> | null;
};

export type AuditListResponse = {
	results: AuditEntry[];
	total: number;
	page: number;
	limit: number;
};

export type AuditExportFormat = 'csv' | 'json' | 'txt';

export const useAuditStore = defineStore('audit', () => {
	const authStore = useAuthStore();

	const inFlight = reactive(new Map<string, Promise<AuditListResponse | null>>());

	const authHeaders = (): Record<string, string> => bearerHeaders(authStore.sessionToken);

	const list = async (q: AuditQuery = {}): Promise<AuditListResponse | null> => {
		const key = buildAuditParams(q).toString();
		const existing = inFlight.get(key);
		if (existing) return existing;

		const promise = (async () => {
			try {
				return await $fetch<AuditListResponse>(`/api/audit?${key}`, {
					cache: 'no-store',
					credentials: 'include',
					headers: authHeaders()
				});
			} catch (error) {
				console.error('Failed to fetch audit log:', error);
				return null;
			} finally {
				inFlight.delete(key);
			}
		})();

		inFlight.set(key, promise);
		return promise;
	};

	// stream the export as a blob and trigger a browser download
	const download = async (q: AuditQuery, format: AuditExportFormat): Promise<void> => {
		const params = buildAuditParams(q);
		params.append('format', format);
		const blob = await $fetch<Blob>(`/api/audit/export?${params.toString()}`, {
			responseType: 'blob',
			credentials: 'include',
			headers: authHeaders()
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `audit.${format}`;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
	};

	return { list, download, buildParams: buildAuditParams };
});
