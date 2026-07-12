<template>
	<UModal v-model:open="open">
		<template #content>
			<UCard>
				<template #header>
					<div class="flex items-center gap-2">
						<UIcon
							name="mdi:code-braces"
							class="size-5 text-primary-500"
						/>
						<h2 class="text-lg font-semibold">Available Placeholders</h2>
					</div>
				</template>

				<p class="mb-3 text-xs text-slate-500">
					Insert these tokens in the message body; they are replaced with live values when the flow
					runs. Unknown tokens are left blank.
				</p>

				<div class="divide-y divide-slate-100 dark:divide-slate-800">
					<div
						v-for="p in placeholders"
						:key="p.token"
						class="flex items-center justify-between gap-4 py-2"
					>
						<code
							class="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-primary-600 dark:bg-slate-800 dark:text-primary-400"
							>{{ p.token }}</code
						>
						<span class="text-right text-xs text-slate-500">{{ p.description }}</span>
					</div>
				</div>

				<template #footer>
					<div class="flex justify-end">
						<UButton
							color="neutral"
							variant="ghost"
							@click="
								() => {
									open = false;
								}
							"
							>Close</UButton
						>
					</div>
				</template>
			</UCard>
		</template>
	</UModal>
</template>

<script setup lang="ts">
import type { FlowTrigger } from '~/shared/types/ticket';

const open = defineModel<boolean>('open', { default: false });
const props = defineProps<{ trigger: FlowTrigger }>();

const TICKET_PLACEHOLDERS = [
	{ token: '{{ticket.title}}', description: 'The ticket title' },
	{ token: '{{ticket.id}}', description: 'The ticket ID' },
	{ token: '{{ticket.status}}', description: 'The ticket status' },
	{ token: '{{ticket.priority}}', description: 'The ticket priority' },
	{ token: '{{ticket.description}}', description: 'The ticket description' }
];
const CUSTOMER_PLACEHOLDERS = [
	{ token: '{{customer.email}}', description: "The customer's email address" },
	{ token: '{{customer.name}}', description: "The customer's name" }
];
const LABEL_PLACEHOLDERS = [
	{ token: '{{label.name}}', description: 'The label name' },
	{ token: '{{label.color}}', description: 'The label color' }
];
const ASSIGNEE_PLACEHOLDERS = [
	{ token: '{{assignee.name}}', description: "The assignee's name" },
	{ token: '{{assignee.username}}', description: "The assignee's username" }
];
const AGENT_PLACEHOLDERS = [
	{ token: '{{agent.username}}', description: "The agent's username" },
	{ token: '{{agent.name}}', description: "The agent's name" },
	{ token: '{{agent.role}}', description: "The agent's role" }
];

// show only the tokens that resolve for the trigger family (mirrors the server placeholder map)
const placeholders = computed(() => {
	switch (props.trigger) {
		case 'customer.created':
			return CUSTOMER_PLACEHOLDERS;
		case 'label.created':
		case 'label.updated':
		case 'label.deleted':
			return LABEL_PLACEHOLDERS;
		case 'agent.created':
		case 'agent.updated':
		case 'agent.deleted':
			return AGENT_PLACEHOLDERS;
		case 'label.added':
		case 'label.removed':
			return [...TICKET_PLACEHOLDERS, ...CUSTOMER_PLACEHOLDERS, ...LABEL_PLACEHOLDERS];
		case 'assignee.added':
		case 'assignee.removed':
			return [...TICKET_PLACEHOLDERS, ...CUSTOMER_PLACEHOLDERS, ...ASSIGNEE_PLACEHOLDERS];
		default:
			return [...TICKET_PLACEHOLDERS, ...CUSTOMER_PLACEHOLDERS];
	}
});
</script>
