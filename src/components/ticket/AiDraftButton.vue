<template>
	<UButton
		v-if="aiEnabled"
		icon="mdi:robot"
		color="neutral"
		variant="soft"
		:loading="loading"
		@click="draft"
	>
		Draft with AI
	</UButton>
</template>

<script setup lang="ts">
const props = defineProps<{ ticketId: number }>();
const emit = defineEmits<{ draft: [text: string] }>();

const toast = useToast();
const { settings } = useSettings();
const { sessionToken } = useAuth();

const aiEnabled = computed(() => settings.value?.ai?.enabled === true);
const loading = ref(false);

async function draft() {
	loading.value = true;
	try {
		const headers: Record<string, string> = {};
		if (sessionToken.value) headers.Authorization = `Bearer ${sessionToken.value}`;
		const result = await $fetch<{ text: string; model: string }>(
			`/api/tickets/${props.ticketId}/ai-draft`,
			{ method: 'POST', credentials: 'include', headers }
		);
		emit('draft', result.text);
	} catch (error) {
		toast.add({
			title: 'Draft Failed',
			description: extractServerMessage(error, 'Could not generate an AI reply.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		loading.value = false;
	}
}
</script>
