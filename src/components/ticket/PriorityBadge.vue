<template>
	<UBadge
		:color="meta.color"
		variant="soft"
		:icon="meta.icon"
		:size="size"
		>{{ meta.label }}</UBadge
	>
</template>

<script setup lang="ts">
import { TicketPriority } from '~/shared/types/ticket';

const props = withDefaults(defineProps<{ priority: TicketPriority; size?: string }>(), {
	size: 'sm'
});

type Meta = { label: string; color: string; icon: string };

const PRIORITY_META: Record<TicketPriority, Meta> = {
	[TicketPriority.None]: { label: 'None', color: 'neutral', icon: 'mdi:minus' },
	[TicketPriority.Low]: { label: 'Low', color: 'info', icon: 'mdi:chevron-down' },
	[TicketPriority.Medium]: { label: 'Medium', color: 'warning', icon: 'mdi:equal' },
	[TicketPriority.High]: { label: 'High', color: 'error', icon: 'mdi:chevron-up' },
	[TicketPriority.Critical]: {
		label: 'Critical',
		color: 'error',
		icon: 'mdi:alert-octagon-outline'
	}
};

const meta = computed<Meta>(
	() =>
		PRIORITY_META[props.priority] ?? { label: props.priority, color: 'neutral', icon: 'mdi:help' }
);
</script>
