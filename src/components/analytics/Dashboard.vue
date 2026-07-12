<template>
	<div class="flex flex-col gap-6">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-lg font-semibold">Ticket Analytics</h2>
			<USelect
				v-model="range"
				:items="rangeItems"
				icon="mdi:calendar-range"
				size="sm"
				class="w-40"
			/>
		</div>

		<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			<UContextMenu
				v-for="kpi in kpis"
				:key="kpi.label"
				:items="widgetMenu({ onRefresh: refresh })"
			>
				<div
					class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
				>
					<div class="flex items-center gap-2 text-slate-400">
						<UIcon
							:name="kpi.icon"
							class="size-4"
						/>
						<span class="text-xs font-medium uppercase tracking-wide">{{ kpi.label }}</span>
					</div>
					<p class="mt-2 text-2xl font-semibold tabular-nums">{{ kpi.value }}</p>
				</div>
			</UContextMenu>
		</div>

		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
			<UContextMenu :items="widgetMenu({ onRefresh: refresh })">
				<div
					class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
				>
					<div class="mb-3 flex items-center justify-between">
						<h3 class="text-sm font-semibold">Ticket Volume</h3>
						<span class="text-xs text-slate-400">{{ volume.length }} days</span>
					</div>
					<AnalyticsSparkline
						:data="volumeSeries"
						:width="320"
						:height="72"
						label="Ticket volume"
						class="w-full text-primary-500"
					/>
				</div>
			</UContextMenu>

			<UContextMenu :items="widgetMenu({ onRefresh: refresh })">
				<div
					class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
				>
					<h3 class="mb-3 text-sm font-semibold">By Status</h3>
					<AnalyticsBarChart :items="statusBars" />
				</div>
			</UContextMenu>

			<UContextMenu :items="widgetMenu({ onRefresh: refresh })">
				<div
					class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
				>
					<h3 class="mb-3 text-sm font-semibold">By Priority</h3>
					<AnalyticsBarChart :items="priorityBars" />
				</div>
			</UContextMenu>

			<UContextMenu :items="widgetMenu({ onRefresh: refresh })">
				<div
					class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
				>
					<h3 class="mb-3 text-sm font-semibold">Channel Mix</h3>
					<AnalyticsBarChart :items="channelBars" />
				</div>
			</UContextMenu>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { AnalyticsRange } from '~/stores/analytics';

const { range, summary, fetchSummary } = useAnalytics('30d');
const { widgetMenu } = useEntityMenus();

const refresh = () => fetchSummary(undefined, true);

const rangeItems: { label: string; value: AnalyticsRange }[] = [
	{ label: 'Last 7 Days', value: '7d' },
	{ label: 'Last 30 Days', value: '30d' },
	{ label: 'Last 90 Days', value: '90d' },
	{ label: 'All Time', value: 'all' }
];

const total = computed(() => Number(summary.value?.total ?? 0));
const open = computed(() => Number(summary.value?.open ?? 0));
const resolved = computed(() => Number(summary.value?.resolved ?? 0));
const emailShare = computed(() => Number(summary.value?.email_channel_share ?? 0));

const kpis = computed(() => [
	{ label: 'Total Tickets', value: total.value, icon: 'mdi:ticket-outline' },
	{ label: 'Open', value: open.value, icon: 'mdi:folder-open-outline' },
	{ label: 'Resolved', value: resolved.value, icon: 'mdi:check-circle-outline' },
	{
		label: 'Email Share',
		value: `${Math.round(emailShare.value * 100)}%`,
		icon: 'mdi:email-outline'
	}
]);

const volume = computed<{ date: string; count: number }[]>(
	() => summary.value?.volume_by_day ?? []
);
const volumeSeries = computed(() => volume.value.map((entry) => entry.count));

const statusBars = computed(() => {
	const byStatus = (summary.value?.by_status ?? {}) as Record<string, number>;
	return Object.entries(byStatus)
		.filter(([, count]) => count > 0)
		.map(([status, count]) => ({ label: statusLabel(status), value: count }));
});

const priorityBars = computed(() => {
	const byPriority = (summary.value?.by_priority ?? {}) as Record<string, number>;
	return Object.entries(byPriority)
		.filter(([, count]) => count > 0)
		.map(([priority, count]) => ({
			label: priority.charAt(0).toUpperCase() + priority.slice(1),
			value: count
		}));
});

const channelBars = computed(() => {
	const emailCount = Math.round(emailShare.value * total.value);
	return [
		{ label: 'Email', value: emailCount, color: '#3b82f6' },
		{ label: 'Direct', value: Math.max(total.value - emailCount, 0), color: '#10b981' }
	];
});

function statusLabel(status: string): string {
	return status
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}
</script>
