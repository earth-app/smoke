<template>
	<div class="flex flex-wrap items-end gap-2">
		<UFormField
			label="Field"
			size="sm"
			class="min-w-32 flex-1"
		>
			<USelect
				v-model="model.field"
				:items="fieldItems"
				class="w-full"
			/>
		</UFormField>
		<UFormField
			label="Operator"
			size="sm"
			class="min-w-32 flex-1"
		>
			<USelect
				v-model="model.operator"
				:items="operatorItems"
				class="w-full"
			/>
		</UFormField>
		<UFormField
			label="Value"
			size="sm"
			class="min-w-40 flex-2"
		>
			<FlowListBuilder
				v-if="model.operator === 'in_list'"
				v-model="model.value"
			/>
			<UInput
				v-else
				v-model="model.value"
				:placeholder="valuePlaceholder"
				class="w-full"
			/>
		</UFormField>
		<UButton
			color="error"
			variant="ghost"
			icon="mdi:close"
			size="sm"
			aria-label="Remove Condition"
			@click="emit('remove')"
		/>
	</div>
</template>

<script setup lang="ts">
import type { FlowCondition } from '~/shared/types/ticket';
import { TicketPriority, TicketStatus } from '~/shared/types/ticket';

const model = defineModel<FlowCondition>({ required: true });
const emit = defineEmits<{ remove: [] }>();

// status/priority pull a representative icon from the shared display maps
const fieldItems = [
	{ label: 'Title', value: 'title', icon: 'mdi:format-title' },
	{ label: 'Description', value: 'description', icon: 'mdi:text-long' },
	{ label: 'Status', value: 'status', icon: STATUS_DISPLAY[TicketStatus.Open].icon },
	{ label: 'Priority', value: 'priority', icon: PRIORITY_DISPLAY[TicketPriority.High].icon },
	{ label: 'Customer Email', value: 'customer_email', icon: 'mdi:email-outline' }
];

const operatorItems = [
	{ label: 'Contains', value: 'contains', icon: 'mdi:contain' },
	{ label: 'Does not Contain', value: 'not_contains', icon: 'mdi:contain-end' },
	{ label: 'Equals', value: 'equals', icon: 'mdi:equal' },
	{ label: 'Starts With', value: 'starts_with', icon: 'mdi:contain-start' },
	{ label: 'Ends With', value: 'ends_with', icon: 'mdi:contain-end' },
	{ label: 'Greater Than', value: 'gt', icon: 'mdi:greater-than' },
	{ label: 'Less Than', value: 'lt', icon: 'mdi:less-than' },
	{ label: 'In List', value: 'in_list', icon: 'mdi:format-list-bulleted' },
	{ label: 'Matches (Regex)', value: 'matches', icon: 'mdi:regex' }
];

const valuePlaceholder = computed(() => {
	const { operator, field } = model.value;
	if (operator === 'matches') return 'e.g. ^refund|billing';
	if (operator === 'gt' || operator === 'lt') {
		if (field === 'priority') return 'e.g. medium';
		if (field === 'status') return 'e.g. open';
		return 'e.g. 5';
	}
	if (field === 'priority') return 'e.g. high';
	if (field === 'status') return 'e.g. open';
	return 'Value to compare against';
});
</script>
