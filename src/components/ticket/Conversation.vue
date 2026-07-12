<template>
	<div class="space-y-6">
		<UCard>
			<div class="flex items-start gap-4">
				<UAvatar
					v-if="header.icon"
					:icon="header.icon"
					size="lg"
					class="shrink-0"
					:style="iconStyle"
				/>
				<span
					v-else-if="header.color"
					class="mt-1 h-12 w-1.5 shrink-0 rounded-full"
					:style="{ backgroundColor: header.color }"
				/>

				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="font-mono text-sm text-muted">#{{ header.id }}</p>
							<h2 class="text-xl font-semibold">{{ header.title }}</h2>
						</div>
						<div class="flex shrink-0 items-center gap-1.5">
							<UBadge
								:color="statusMeta.color"
								variant="subtle"
								:icon="statusMeta.icon"
								>{{ statusMeta.label }}</UBadge
							>
							<UBadge
								:color="priorityMeta.color"
								variant="subtle"
								:icon="priorityMeta.icon"
								>{{ priorityMeta.label }}</UBadge
							>
						</div>
					</div>

					<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
						<span class="inline-flex items-center gap-1.5">
							<UIcon
								name="mdi:account-outline"
								class="size-4"
							/>
							{{ creatorLabel }}
							<UBadge
								v-if="header.creator?.staff"
								color="primary"
								variant="subtle"
								size="xs"
								>Staff</UBadge
							>
						</span>
						<span class="inline-flex items-center gap-1.5">
							<UIcon
								name="mdi:clock-outline"
								class="size-4"
							/>
							Opened {{ createdLabel }}
						</span>
					</div>
				</div>
			</div>
		</UCard>

		<UAlert
			v-if="locked || archived"
			:icon="locked ? 'mdi:lock' : 'mdi:archive-outline'"
			color="neutral"
			variant="subtle"
			:title="locked ? 'This Request is Locked' : 'This Request is Archived'"
			:description="
				locked ? 'The conversation is closed to new replies.' : 'This request has been archived.'
			"
		/>

		<div
			v-if="header.description"
			class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
		>
			<p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Description</p>
			<p class="mt-1 whitespace-pre-wrap text-sm">{{ header.description }}</p>
		</div>

		<div v-if="canReply && $slots.reply">
			<slot name="reply" />
		</div>

		<div>
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<h3 class="text-lg font-semibold">Conversation</h3>
				<div class="flex items-center gap-1">
					<UButton
						color="neutral"
						variant="ghost"
						size="xs"
						:icon="
							order === 'asc'
								? 'mdi:sort-clock-ascending-outline'
								: 'mdi:sort-clock-descending-outline'
						"
						@click="toggleOrder"
						>{{ order === 'asc' ? 'Oldest First' : 'Newest First' }}</UButton
					>
					<UButton
						color="neutral"
						:variant="compact ? 'soft' : 'ghost'"
						size="xs"
						icon="mdi:view-compact-outline"
						:aria-pressed="compact"
						@click="toggleCompact"
						>Compact</UButton
					>
				</div>
			</div>
			<TicketThread
				:entries="entries"
				:pending="pending"
				:compact="compact"
			/>
		</div>

		<div
			v-if="$slots.actions"
			class="flex flex-wrap items-center gap-2"
		>
			<slot name="actions" />
		</div>
	</div>
</template>

<script setup lang="ts">
import type {
	TicketEvent,
	TicketMessage,
	TicketPriority,
	TicketStatus
} from '~/shared/types/ticket';

type ConversationHeader = {
	id: number;
	title: string;
	status: TicketStatus;
	priority: TicketPriority;
	created_at: string | number | Date;
	description?: string | null;
	color?: string | null;
	icon?: string | null;
	creator?: { name?: string; email?: string; staff?: boolean } | null;
};

const props = withDefaults(
	defineProps<{
		header: ConversationHeader;
		messages: TicketMessage[];
		events?: TicketEvent[];
		pending?: boolean;
		locked?: boolean;
		archived?: boolean;
		canReply?: boolean;
	}>(),
	{
		events: () => [],
		pending: false,
		locked: false,
		archived: false,
		canReply: false
	}
);

const { order, compact, toggleOrder, toggleCompact } = useTicketView();

// interleave messages + timeline events, ordered by the saved view preference
const entries = computed(() => mergeThreadEntries(props.messages, props.events, order.value));

const statusMeta = computed(
	() =>
		STATUS_DISPLAY[props.header.status] ?? {
			label: props.header.status,
			icon: 'mdi:help',
			color: 'neutral'
		}
);
const priorityMeta = computed(
	() =>
		PRIORITY_DISPLAY[props.header.priority] ?? {
			label: props.header.priority,
			icon: 'mdi:help',
			color: 'neutral'
		}
);

// tinted icon chip; color is a hex, so tint the bg and stroke inline (theme tokens don't apply)
const iconStyle = computed(() =>
	props.header.color
		? { backgroundColor: `${props.header.color}1a`, color: props.header.color }
		: undefined
);

const creatorLabel = computed(() => {
	const creator = props.header.creator;
	return creator?.name || creator?.email || 'Guest';
});

const createdLabel = computed(() => formatDateTime(props.header.created_at));

function formatDateTime(value: string | number | Date): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
</script>
