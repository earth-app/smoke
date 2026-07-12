<template>
	<div :class="['flex items-center gap-2 text-xs text-muted', compact ? 'py-0' : 'py-0.5']">
		<UIcon
			:name="icon"
			class="size-4 shrink-0 text-slate-400"
		/>
		<span class="min-w-0 flex-1 truncate">
			<span class="font-medium text-default">{{ actorName }}</span>
			{{ phrase }}
			<span
				v-if="event.flow_name"
				class="italic"
				>by {{ event.flow_name }}</span
			>
		</span>
		<span
			class="shrink-0 text-slate-400"
			:title="fullTime"
			>{{ relative }}</span
		>
	</div>
</template>

<script setup lang="ts">
import type { TicketEvent, TicketEventKind } from '~/shared/types/ticket';

const props = withDefaults(defineProps<{ event: TicketEvent; compact?: boolean }>(), {
	compact: false
});

// per-kind timeline icon (iconify)
const EVENT_ICON: Record<TicketEventKind, string> = {
	created: 'mdi:plus-circle-outline',
	renamed: 'mdi:form-textbox',
	status: 'mdi:progress-check',
	priority: 'mdi:flag-outline',
	visibility: 'mdi:eye-outline',
	deadline: 'mdi:calendar-clock',
	color: 'mdi:palette-outline',
	icon: 'mdi:image-outline',
	label_added: 'mdi:tag-plus-outline',
	label_removed: 'mdi:tag-minus-outline',
	assignee_added: 'mdi:account-plus-outline',
	assignee_removed: 'mdi:account-minus-outline',
	project_added: 'mdi:folder-plus-outline',
	project_removed: 'mdi:folder-minus-outline',
	locked: 'mdi:lock-outline',
	unlocked: 'mdi:lock-open-variant-outline',
	archived: 'mdi:archive-outline',
	unarchived: 'mdi:archive-arrow-up-outline',
	closed: 'mdi:check-circle-outline',
	reopened: 'mdi:refresh',
	customer_changed: 'mdi:account-switch-outline'
};

const icon = computed(() => EVENT_ICON[props.event.kind] ?? 'mdi:circle-small');

const actorName = computed(() => {
	const a = props.event.actor;
	if (!a) return 'System';
	if (a.kind === 'user') return a.name || a.username || 'Team';
	return a.name || a.email || 'Customer';
});

function statusLabel(value?: string): string {
	if (!value) return '';
	const meta = STATUS_DISPLAY[value as keyof typeof STATUS_DISPLAY];
	return meta ? meta.label : value;
}

function priorityLabel(value?: string): string {
	if (!value) return '';
	const meta = PRIORITY_DISPLAY[value as keyof typeof PRIORITY_DISPLAY];
	return meta ? meta.label : value;
}

function visibilityLabel(value?: string): string {
	if (!value) return '';
	const meta = VISIBILITY_DISPLAY[value as keyof typeof VISIBILITY_DISPLAY];
	return meta ? meta.label : value;
}

// human phrase describing the change; actor name is prepended in the template
const phrase = computed(() => {
	const e = props.event;
	switch (e.kind) {
		case 'created':
			return 'opened this request';
		case 'renamed':
			return e.from ? `renamed this from "${e.from}" to "${e.to}"` : `renamed this to "${e.to}"`;
		case 'status':
			return e.from
				? `changed status from ${statusLabel(e.from)} to ${statusLabel(e.to)}`
				: `set status to ${statusLabel(e.to)}`;
		case 'priority':
			return e.from
				? `changed priority from ${priorityLabel(e.from)} to ${priorityLabel(e.to)}`
				: `set priority to ${priorityLabel(e.to)}`;
		case 'visibility':
			return `changed visibility to ${visibilityLabel(e.to)}`;
		case 'deadline':
			return e.to ? `set the deadline to ${e.to}` : 'cleared the deadline';
		case 'color':
			return 'changed the color';
		case 'icon':
			return 'changed the icon';
		case 'label_added':
			return `added label ${e.label ?? e.to ?? ''}`.trim();
		case 'label_removed':
			return `removed label ${e.label ?? e.from ?? ''}`.trim();
		case 'assignee_added':
			return `assigned ${e.label ?? e.to ?? ''}`.trim();
		case 'assignee_removed':
			return `unassigned ${e.label ?? e.from ?? ''}`.trim();
		case 'project_added':
			return `added this to project ${e.label ?? e.to ?? ''}`.trim();
		case 'project_removed':
			return `removed this from project ${e.label ?? e.from ?? ''}`.trim();
		case 'locked':
			return 'locked the conversation';
		case 'unlocked':
			return 'unlocked the conversation';
		case 'archived':
			return 'archived this request';
		case 'unarchived':
			return 'unarchived this request';
		case 'closed':
			return 'closed this request';
		case 'reopened':
			return 'reopened this request';
		case 'customer_changed':
			return 'changed the customer';
		default:
			return 'updated this request';
	}
});

const fullTime = computed(() => {
	const d = new Date(props.event.created_at);
	return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
});

// coarse relative time (just now / Nm / Nh / Nd / date)
const relative = computed(() => {
	const then = new Date(props.event.created_at).getTime();
	if (Number.isNaN(then)) return '';
	const sec = Math.round((Date.now() - then) / 1000);
	if (sec < 45) return 'just now';
	const min = Math.round(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.round(hr / 24);
	if (day < 30) return `${day}d ago`;
	return new Date(then).toLocaleDateString(undefined, { dateStyle: 'medium' });
});
</script>
