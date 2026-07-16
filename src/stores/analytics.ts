import { defineStore } from 'pinia';
import { useAuthStore } from '~/stores/auth';

export type AnalyticsRange = '7d' | '30d' | '90d' | 'all';

export type AnalyticsSummary = Record<string, any>;

export const useAnalyticsStore = defineStore('analytics', () => {
	// request-scoped so internal api reads route in-process during ssr (avoids the self-loopback stall)
	const requestFetch = useRequestFetch();
	const authStore = useAuthStore();

	const cache = reactive(new Map<AnalyticsRange, AnalyticsSummary>());
	const inFlight = reactive(new Map<AnalyticsRange, Promise<AnalyticsSummary | null>>());

	const authHeaders = (): Record<string, string> => bearerHeaders(authStore.sessionToken);

	const summary = async (
		range: AnalyticsRange = '7d',
		force: boolean = false
	): Promise<AnalyticsSummary | null> => {
		if (!force && cache.has(range)) return cache.get(range) || null;

		const existing = inFlight.get(range);
		if (existing) return existing;

		const promise = (async () => {
			try {
				const result = await requestFetch<AnalyticsSummary>(
					`/api/analytics/summary?range=${range}`,
					{
						cache: 'no-store',
						credentials: 'include',
						headers: authHeaders()
					}
				);
				cache.set(range, result);
				return result;
			} catch (error) {
				console.error(`Failed to fetch analytics summary for range "${range}":`, error);
				return cache.get(range) || null;
			} finally {
				inFlight.delete(range);
			}
		})();

		inFlight.set(range, promise);
		return promise;
	};

	return {
		cache,
		summary
	};
});
