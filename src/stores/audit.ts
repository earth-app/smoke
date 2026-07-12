import { defineStore } from 'pinia';
import { useAuthStore } from '~/stores/auth';

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

export type AuditQuery = {
	search?: string;
	action?: string;
	actor_id?: string;
	ticket_id?: number;
	priority?: string;
	// unix seconds inclusive range
	from?: number;
	to?: number;
	page?: number;
	limit?: number;
	sort?: string;
	sort_direction?: 'asc' | 'desc';
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

	const authHeaders = (): Record<string, string> => {
		const token = authStore.sessionToken;
		return token ? { Authorization: `Bearer ${token}` } : {};
	};

	const buildParams = (q: AuditQuery): URLSearchParams => {
		const params = new URLSearchParams();
		if (q.search) params.append('search', q.search);
		if (q.action) params.append('action', q.action);
		if (q.actor_id) params.append('actor_id', q.actor_id);
		if (q.ticket_id != null) params.append('ticket_id', String(q.ticket_id));
		if (q.priority) params.append('priority', q.priority);
		if (q.from != null) params.append('from', String(q.from));
		if (q.to != null) params.append('to', String(q.to));
		if (q.page) params.append('page', String(q.page));
		if (q.limit) params.append('limit', String(q.limit));
		if (q.sort) params.append('sort', q.sort);
		if (q.sort_direction) params.append('sort_direction', q.sort_direction);
		return params;
	};

	const list = async (q: AuditQuery = {}): Promise<AuditListResponse | null> => {
		const key = buildParams(q).toString();
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
		const params = buildParams(q);
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

	return { list, download, buildParams };
});
