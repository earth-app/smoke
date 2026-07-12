<template>
	<div
		v-if="ticket.locked || ticket.archived"
		class="flex flex-col gap-2"
	>
		<UAlert
			v-if="ticket.locked"
			color="warning"
			variant="subtle"
			icon="mdi:lock-outline"
			title="This Thread is Locked"
			description="New replies are turned off. Reopen the request to continue the conversation."
		/>
		<UAlert
			v-if="ticket.archived"
			color="neutral"
			variant="subtle"
			icon="mdi:archive-outline"
			title="This Ticket is Archived"
			description="This ticket was archived by the retention policy and is kept for reference."
		/>
	</div>
</template>

<script setup lang="ts">
import type { Ticket } from '~/shared/types/ticket';

defineProps<{ ticket: Ticket }>();
</script>
