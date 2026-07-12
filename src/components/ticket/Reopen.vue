<template>
	<UButton
		color="primary"
		variant="soft"
		icon="mdi:lock-reset"
		:loading="loading"
		@click="reopen"
	>
		Reopen Request
	</UButton>
</template>

<script setup lang="ts">
const props = defineProps<{ ticketId: number; token: string; turnstile?: string }>();
const emit = defineEmits<{ reopened: [] }>();

const toast = useToast();
const loading = ref(false);

async function reopen() {
	loading.value = true;
	try {
		await $fetch('/api/public/reopen', {
			method: 'POST',
			body: { id: props.ticketId, token: props.token, turnstile: props.turnstile }
		});
		emit('reopened');
		toast.add({
			title: 'Request Reopened',
			description: 'You can reply to your request again.',
			icon: 'mdi:check-circle',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Could Not Reopen',
			description: extractServerMessage(error, 'This request cannot be reopened right now.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		loading.value = false;
	}
}
</script>
