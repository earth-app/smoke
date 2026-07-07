import type { AnalyticsRange, AnalyticsSummary } from '~/stores/analytics';
import { useAnalyticsStore } from '~/stores/analytics';

export function useAnalytics(initialRange: MaybeRefOrGetter<AnalyticsRange> = '7d') {
	const analyticsStore = useAnalyticsStore();

	const range = ref<AnalyticsRange>(toValue(initialRange));
	const summary = ref<AnalyticsSummary | null>(null);
	const pending = ref(false);

	const fetchSummary = async (
		override?: AnalyticsRange,
		force: boolean = false
	): Promise<AnalyticsSummary | null> => {
		const target = override ?? range.value;
		range.value = target;
		pending.value = true;
		try {
			const result = await analyticsStore.summary(target, force);
			summary.value = result;
			return result;
		} finally {
			pending.value = false;
		}
	};

	// load summary state
	fetchSummary();
	watch(range, (newRange, oldRange) => {
		if (newRange !== oldRange) fetchSummary(newRange);
	});

	return {
		range,
		summary,
		pending,
		fetchSummary
	};
}
