<template>
	<UAlert
		v-if="show"
		:color="tone.color"
		:icon="tone.icon"
		variant="subtle"
		:title="tone.title"
		:description="description"
	/>
</template>

<script setup lang="ts">
import type { Ticket } from '~/shared/types/ticket';

const props = defineProps<{ ticket: Ticket }>();

const { isAuthenticated } = useAuth();
const { settings } = useSettings();

const DAY = 86_400_000;

// retention.delete_days is the destructive window; null/0 means never delete
const deleteDays = computed<number | null>(() => {
	const value = (settings.value as any)?.retention?.delete_days;
	return typeof value === 'number' ? value : null;
});

const archivedAtMs = computed<number | null>(() => {
	const raw = props.ticket?.archived_at;
	if (!raw) return null;
	const ms = raw instanceof Date ? raw.getTime() : new Date(raw as any).getTime();
	return Number.isNaN(ms) ? null : ms;
});

// staff-only; only meaningful once the ticket is archived and a delete window is configured
const show = computed(
	() =>
		isAuthenticated.value &&
		props.ticket?.archived === true &&
		typeof deleteDays.value === 'number' &&
		deleteDays.value > 0 &&
		archivedAtMs.value != null
);

const daysLeft = computed(() => {
	if (archivedAtMs.value == null || deleteDays.value == null) return 0;
	const elapsed = (Date.now() - archivedAtMs.value) / DAY;
	return Math.max(0, Math.ceil(deleteDays.value - elapsed));
});

const dayLabel = computed(() => `${daysLeft.value} ${daysLeft.value === 1 ? 'Day' : 'Days'}`);

// escalate the color/icon/copy as the deletion date approaches
const tone = computed<{ color: 'info' | 'warning' | 'error'; icon: string; title: string }>(() => {
	if (daysLeft.value <= 7) {
		return { color: 'error', icon: 'mdi:delete-alert', title: `Deleting in ${dayLabel.value}` };
	}
	if (daysLeft.value <= 30) {
		return {
			color: 'warning',
			icon: 'mdi:delete-clock',
			title: `This Request Will Be Deleted in ${dayLabel.value}`
		};
	}
	return {
		color: 'info',
		icon: 'mdi:information-outline',
		title: `This Request Will Be Deleted in ${dayLabel.value}`
	};
});

const description = computed(() => {
	if (archivedAtMs.value == null || deleteDays.value == null) return '';
	const on = new Date(archivedAtMs.value + deleteDays.value * DAY).toLocaleDateString(undefined, {
		dateStyle: 'long'
	});
	return `This archived request is scheduled for permanent deletion on ${on}.`;
});
</script>
