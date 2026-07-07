<template>
	<div class="flex flex-col gap-4">
		<div
			v-if="pending && !messages.length"
			class="flex flex-col gap-4"
		>
			<div
				v-for="n in 3"
				:key="n"
				class="flex gap-3"
			>
				<USkeleton class="size-8 rounded-full" />
				<div class="flex-1 space-y-2">
					<USkeleton class="h-4 w-32" />
					<USkeleton class="h-16 w-2/3 rounded-lg" />
				</div>
			</div>
		</div>

		<div
			v-else-if="!messages.length"
			class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-200 py-12 text-center dark:border-slate-800"
		>
			<UIcon
				name="mdi:message-outline"
				class="size-8 text-slate-300"
			/>
			<p class="text-sm text-slate-500">No messages yet. Start the conversation below.</p>
		</div>

		<div
			v-else
			class="flex flex-col gap-5"
		>
			<TicketMessage
				v-for="message in messages"
				:key="message.id"
				:message="message"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { TicketMessage } from '~/shared/types/ticket';

withDefaults(defineProps<{ messages: TicketMessage[]; pending?: boolean }>(), {
	pending: false
});
</script>
