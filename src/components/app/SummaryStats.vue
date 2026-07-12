<template>
	<div>
		<div class="mb-3 flex items-center justify-between">
			<h2 class="text-xs font-semibold uppercase tracking-wide text-slate-500">At a Glance</h2>
			<UButton
				to="/dashboard"
				variant="link"
				color="primary"
				size="xs"
				icon="mdi:chart-box-outline"
				>View Analytics</UButton
			>
		</div>

		<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			<AppStatCard
				v-for="card in cards"
				:key="card.label"
				:label="card.label"
				:value="card.value"
				:icon="card.icon"
				:to="card.to"
				:loading="loading"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
// analytics summary is gated by ManageTicket; only mount this when the caller permits it
const { summary, pending } = useAnalytics('30d');

const loading = computed(() => pending.value && !summary.value);

const cards = computed(() => [
	{
		label: 'Open Tickets',
		value: Number(summary.value?.open ?? 0),
		icon: 'mdi:folder-open-outline',
		to: '/dashboard/tickets'
	},
	{
		label: 'Total Tickets',
		value: Number(summary.value?.total ?? 0),
		icon: 'mdi:ticket-outline',
		to: '/dashboard/tickets'
	},
	{
		label: 'Resolved',
		value: Number(summary.value?.resolved ?? 0),
		icon: 'mdi:check-circle-outline',
		to: undefined as string | undefined
	},
	{
		label: 'Email Share',
		value: `${Math.round(Number(summary.value?.email_channel_share ?? 0) * 100)}%`,
		icon: 'mdi:email-outline',
		to: undefined as string | undefined
	}
]);
</script>
