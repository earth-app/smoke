<template>
	<div :class="['flex gap-3', isAgent ? 'flex-row-reverse text-right' : 'flex-row']">
		<UAvatar
			:src="message.sender.avatar_url"
			:alt="senderName"
			size="sm"
			class="mt-1 shrink-0"
		/>
		<div class="min-w-0 flex-1">
			<div :class="['flex items-center gap-2', isAgent ? 'justify-end' : 'justify-start']">
				<span class="text-sm font-medium">{{ senderName }}</span>
				<UBadge
					:color="isAgent ? 'primary' : 'neutral'"
					variant="subtle"
					size="xs"
					>{{ isAgent ? 'Team' : 'Customer' }}</UBadge
				>
				<UBadge
					v-if="message.private"
					color="warning"
					variant="subtle"
					size="xs"
					icon="mdi:lock-outline"
					>Internal</UBadge
				>
				<span class="text-xs text-slate-400">{{ timestamp }}</span>
			</div>
			<div
				:class="[
					'mt-1 inline-block max-w-full whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm',
					isAgent
						? 'bg-primary-50 text-slate-800 dark:bg-primary-950 dark:text-slate-100'
						: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
				]"
			>
				{{ message.message }}
			</div>
			<div
				v-if="message.attachments?.length"
				:class="['mt-2 flex flex-wrap gap-2', isAgent ? 'justify-end' : 'justify-start']"
			>
				<span
					v-for="attachment in message.attachments"
					:key="attachment.id"
					class="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
				>
					<UIcon
						name="mdi:paperclip"
						class="size-3.5"
					/>
					{{ attachment.file_name }}
				</span>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { TicketMessage } from '~/shared/types/ticket';

const props = defineProps<{ message: TicketMessage }>();

const isAgent = computed(() => props.message.sender.kind === 'user');

const senderName = computed(() => {
	const sender = props.message.sender;
	if (sender.kind === 'user') return sender.name || sender.username || 'Team';
	return sender.name || sender.email || 'Customer';
});

const timestamp = computed(() => {
	const date = new Date(props.message.created_at);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleString();
});
</script>
