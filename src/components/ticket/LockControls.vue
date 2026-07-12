<template>
	<div class="flex flex-wrap items-center gap-2">
		<UButton
			v-if="canLock"
			:color="ticket.locked ? 'warning' : 'neutral'"
			variant="soft"
			:icon="ticket.locked ? 'mdi:lock-open-variant-outline' : 'mdi:lock-outline'"
			:loading="lockLoading"
			size="sm"
			@click="toggleLock"
		>
			{{ ticket.locked ? 'Unlock Thread' : 'Lock Thread' }}
		</UButton>

		<UButton
			v-if="canArchive"
			:color="ticket.archived ? 'primary' : 'neutral'"
			variant="soft"
			:icon="ticket.archived ? 'mdi:archive-arrow-up-outline' : 'mdi:archive-outline'"
			:loading="archiveLoading"
			size="sm"
			@click="toggleArchive"
		>
			{{ ticket.archived ? 'Unarchive' : 'Archive' }}
		</UButton>
	</div>
</template>

<script setup lang="ts">
import type { Ticket } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';

const props = defineProps<{ ticket: Ticket }>();
const emit = defineEmits<{ changed: [] }>();

const toast = useToast();
const { can, sessionToken } = useAuth();

const canLock = computed(() => can(Permission.LockThread));
const canArchive = computed(() => can(Permission.ManageTicket));

const lockLoading = ref(false);
const archiveLoading = ref(false);

const authHeaders = (): Record<string, string> =>
	sessionToken.value ? { Authorization: `Bearer ${sessionToken.value}` } : {};

async function toggleLock() {
	const next = !props.ticket.locked;
	lockLoading.value = true;
	try {
		await $fetch(`/api/tickets/${props.ticket.id}/lock`, {
			method: 'POST',
			body: { locked: next },
			credentials: 'include',
			headers: authHeaders()
		});
		emit('changed');
		toast.add({
			title: next ? 'Thread Locked' : 'Thread Unlocked',
			description: next
				? 'New replies are blocked on this thread.'
				: 'Replies are allowed on this thread again.',
			icon: next ? 'mdi:lock' : 'mdi:lock-open-variant',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Update Lock',
			description: extractServerMessage(error, 'Could not change the lock state.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		lockLoading.value = false;
	}
}

async function toggleArchive() {
	const next = !props.ticket.archived;
	archiveLoading.value = true;
	try {
		await $fetch(`/api/tickets/${props.ticket.id}/archive`, {
			method: 'POST',
			body: { archived: next },
			credentials: 'include',
			headers: authHeaders()
		});
		emit('changed');
		toast.add({
			title: next ? 'Ticket Archived' : 'Ticket Unarchived',
			description: next
				? 'This ticket is hidden from the default lists.'
				: 'This ticket is back in the default lists.',
			icon: next ? 'mdi:archive' : 'mdi:archive-arrow-up',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Update Archive',
			description: extractServerMessage(error, 'Could not change the archive state.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		archiveLoading.value = false;
	}
}
</script>
