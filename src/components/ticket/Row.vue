<template>
	<NuxtLink
		:to="`/dashboard/tickets/${ticket.id}`"
		class="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
	>
		<div class="mt-0.5 shrink-0">
			<UIcon
				v-if="ticket.private"
				name="mdi:lock-outline"
				class="size-4 text-slate-400"
			/>
			<UIcon
				v-else
				name="mdi:ticket-outline"
				class="size-4 text-slate-400"
			/>
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<span class="truncate font-medium">{{ ticket.title }}</span>
				<span class="shrink-0 font-mono text-xs text-slate-400">#{{ ticket.id }}</span>
			</div>
			<p class="mt-0.5 line-clamp-1 text-sm text-slate-500 dark:text-slate-400">
				{{ ticket.description || 'No description' }}
			</p>
			<div
				v-if="labels.length"
				class="mt-1.5 flex flex-wrap items-center gap-1"
			>
				<LabelBadge
					v-for="label in labels"
					:key="label.id"
					:label="label"
				/>
			</div>
		</div>
		<div class="flex shrink-0 flex-col items-end gap-1.5">
			<div class="flex items-center gap-1.5">
				<TicketPriorityBadge :priority="ticket.priority" />
				<TicketStatusBadge :status="ticket.status" />
			</div>
			<div class="flex items-center gap-1">
				<UAvatar
					v-for="assignee in ticket.assignees.slice(0, 3)"
					:key="assignee.id"
					:src="assignee.avatar_url"
					:alt="assignee.username"
					size="2xs"
				/>
				<span
					v-if="ticket.assignees.length > 3"
					class="text-xs text-slate-400"
					>+{{ ticket.assignees.length - 3 }}</span
				>
			</div>
			<span class="text-xs text-slate-400">{{ updatedLabel }}</span>
		</div>
	</NuxtLink>
</template>

<script setup lang="ts">
import type { Ticket } from '~/shared/types/ticket';
import type { Label } from '~/shared/types/user';

const props = defineProps<{ ticket: Ticket }>();

const { labels: allLabels } = useLabels(() => ({}));

const labels = computed<Label[]>(() =>
	(props.ticket.labels || [])
		.map((id) => allLabels.value.find((l) => l.id === id))
		.filter((l): l is Label => !!l)
);

const updatedLabel = computed(() => relativeTime(props.ticket.updated_at));

function relativeTime(value: Date | string | number): string {
	const then = new Date(value).getTime();
	if (!Number.isFinite(then)) return '';
	const diff = Date.now() - then;
	const mins = Math.round(diff / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(then).toLocaleDateString();
}
</script>
