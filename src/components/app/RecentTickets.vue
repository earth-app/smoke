<template>
	<UCard>
		<template #header>
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold">Recent Tickets</h2>
				<UButton
					to="/dashboard/tickets"
					variant="link"
					color="primary"
					size="xs"
					trailing-icon="mdi:arrow-right"
					>View All</UButton
				>
			</div>
		</template>

		<div
			v-if="loading"
			class="divide-y divide-slate-100 dark:divide-slate-800"
		>
			<div
				v-for="i in 5"
				:key="i"
				class="flex items-center justify-between gap-3 py-2.5"
			>
				<div class="min-w-0 flex-1 space-y-1.5">
					<Skeleton
						variant="line"
						width="60%"
						height="0.875rem"
					/>
					<Skeleton
						variant="line"
						width="40%"
						height="0.75rem"
					/>
				</div>
				<Skeleton
					variant="line"
					width="3.5rem"
					height="1.25rem"
					rounded="rounded-full"
				/>
			</div>
		</div>

		<ul
			v-else-if="tickets.length"
			class="divide-y divide-slate-100 dark:divide-slate-800"
		>
			<li
				v-for="ticket in tickets"
				:key="ticket.id"
			>
				<NuxtLink
					:to="`/dashboard/tickets/${ticket.id}`"
					class="flex items-center justify-between gap-3 py-2.5 transition hover:opacity-80"
				>
					<div class="min-w-0">
						<p class="truncate text-sm font-medium">{{ ticket.title }}</p>
						<p class="text-xs text-slate-500">
							#{{ ticket.id }} - Updated {{ formatDate(ticket.updated_at) }}
						</p>
					</div>
					<UBadge
						:color="statusColor(ticket.status)"
						variant="subtle"
						class="shrink-0 capitalize"
						>{{ formatEnum(ticket.status) }}</UBadge
					>
				</NuxtLink>
			</li>
		</ul>

		<div
			v-else
			class="flex flex-col items-center gap-2 py-6 text-center"
		>
			<UIcon
				name="mdi:ticket-outline"
				class="size-8 text-muted"
			/>
			<p class="text-sm text-muted">No Tickets Yet</p>
		</div>
	</UCard>
</template>

<script setup lang="ts">
const { tickets, pending } = useTickets(() => ({
	limit: 5,
	sort: 'updated_at',
	sort_direction: 'desc'
}));

// triple-state: pending w/ no rows yet = loading; resolved empty = empty; resolved rows = list
const loading = computed(() => pending.value && tickets.value.length === 0);

function statusColor(status: string) {
	switch (status) {
		case 'closed':
		case 'wont_fix':
			return 'neutral';
		case 'work_in_progress':
		case 'open':
			return 'info';
		case 'pending':
			return 'warning';
		default:
			return 'primary';
	}
}

function formatEnum(value: string): string {
	return value.replace(/_/g, ' ');
}

function formatDate(value: string | number | Date): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
</script>
