import type { AuditEntry, AuditExportFormat } from '~/stores/audit';
import { useAuditStore } from '~/stores/audit';
import type { AuditQuery } from '~/utils/audit-query';

export function useAudit() {
	const auditStore = useAuditStore();

	const entries = ref<AuditEntry[]>([]);
	const total = ref(0);
	const pending = ref(false);

	const fetchAudit = async (query: AuditQuery = {}): Promise<void> => {
		pending.value = true;
		try {
			const result = await auditStore.list(query);
			if (result) {
				entries.value = result.results;
				total.value = result.total;
			}
		} finally {
			pending.value = false;
		}
	};

	const download = (query: AuditQuery, format: AuditExportFormat): Promise<void> =>
		auditStore.download(query, format);

	return { entries, total, pending, fetchAudit, download };
}
