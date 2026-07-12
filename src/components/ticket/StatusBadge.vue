<template>
	<UBadge
		:color="meta.color"
		variant="subtle"
		:icon="meta.icon"
		:size="size"
		>{{ meta.label }}</UBadge
	>
</template>

<script setup lang="ts">
import { TicketStatus } from '~/shared/types/ticket';

const props = withDefaults(
	defineProps<{ status: TicketStatus; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' }>(),
	{
		size: 'sm'
	}
);

type Meta = {
	label: string;
	color: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';
	icon: string;
};

const STATUS_META: Record<TicketStatus, Meta> = {
	[TicketStatus.Submitted]: { label: 'Submitted', color: 'neutral', icon: 'mdi:inbox-arrow-down' },
	[TicketStatus.Open]: { label: 'Open', color: 'info', icon: 'mdi:folder-open-outline' },
	[TicketStatus.Pending]: { label: 'Pending', color: 'warning', icon: 'mdi:clock-outline' },
	[TicketStatus.WorkInProgress]: {
		label: 'In Progress',
		color: 'primary',
		icon: 'mdi:progress-wrench'
	},
	[TicketStatus.Closed]: { label: 'Closed', color: 'success', icon: 'mdi:check-circle-outline' },
	[TicketStatus.WontFix]: { label: "Won't Fix", color: 'error', icon: 'mdi:cancel' }
};

const meta = computed<Meta>(
	() => STATUS_META[props.status] ?? { label: props.status, color: 'neutral', icon: 'mdi:help' }
);
</script>
