<template>
	<div class="flex flex-col gap-4">
		<div
			class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
		>
			<div class="flex items-start gap-3">
				<UIcon
					name="mdi:cog-transfer-outline"
					class="size-6 text-primary-500"
				/>
				<div class="flex-1">
					<h3 class="text-sm font-semibold">Automation Flows</h3>
					<p class="text-xs text-slate-500">
						Run event, condition, and action rules automatically as tickets change.
					</p>
				</div>
				<UButton
					color="primary"
					icon="mdi:plus"
					size="sm"
					@click="openCreate"
					>New Flow</UButton
				>
			</div>
		</div>

		<div
			class="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
		>
			<div
				v-if="!flows.length"
				class="px-4 py-12 text-center text-sm text-slate-500"
			>
				No flows yet. Create one to automate ticket triage.
			</div>

			<div
				v-else
				class="divide-y divide-slate-100 dark:divide-slate-800"
			>
				<div
					v-for="flow in flows"
					:key="flow.id"
					class="flex items-center gap-3 px-4 py-3"
				>
					<USwitch
						:model-value="flow.enabled"
						:loading="togglingId === flow.id"
						@update:model-value="(v) => toggle(flow, Boolean(v))"
					/>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<p class="truncate text-sm font-medium">{{ flow.name }}</p>
							<UBadge
								:color="flow.enabled ? 'success' : 'neutral'"
								variant="subtle"
								size="sm"
								>{{ triggerLabel(flow.trigger) }}</UBadge
							>
						</div>
						<p class="truncate text-xs text-slate-500">{{ summary(flow) }}</p>
					</div>
					<UTooltip text="Edit Flow">
						<UButton
							color="neutral"
							variant="ghost"
							icon="mdi:pencil-outline"
							size="xs"
							aria-label="Edit Flow"
							@click="openEdit(flow)"
						/>
					</UTooltip>
					<UTooltip text="Delete Flow">
						<UButton
							color="error"
							variant="ghost"
							icon="mdi:delete-outline"
							size="xs"
							aria-label="Delete Flow"
							:loading="deletingId === flow.id"
							@click="remove(flow)"
						/>
					</UTooltip>
				</div>
			</div>
		</div>

		<FlowEditor
			v-model:open="editorOpen"
			:flow="editingFlow"
			@saved="onSaved"
		/>
	</div>
</template>

<script setup lang="ts">
import type { TicketFlow } from '~/shared/types/ticket';

const toast = useToast();
const { flows, updateFlow, deleteFlow } = useFlows();

const editorOpen = ref(false);
const editingFlow = ref<TicketFlow | null>(null);
const togglingId = ref<number | null>(null);
const deletingId = ref<number | null>(null);

const triggerLabels: Record<TicketFlow['trigger'], string> = {
	'ticket.created': 'On Created',
	'ticket.updated': 'On Updated',
	'ticket.message': 'On Message',
	'ticket.deleted': 'On Deleted',
	'customer.created': 'On Customer Created',
	'customer.added': 'On Customer Added',
	'label.added': 'On Label Added',
	'label.removed': 'On Label Removed',
	'assignee.added': 'On Assignee Added',
	'assignee.removed': 'On Assignee Removed',
	'label.created': 'On Label Created',
	'label.updated': 'On Label Updated',
	'label.deleted': 'On Label Deleted',
	'agent.created': 'On Agent Created',
	'agent.updated': 'On Agent Updated',
	'agent.deleted': 'On Agent Deleted'
};

function triggerLabel(trigger: TicketFlow['trigger']): string {
	return triggerLabels[trigger] ?? trigger;
}

function summary(flow: TicketFlow): string {
	const conditions = flow.conditions.length;
	const actions = flow.actions.length;
	const match = flow.match === 'any' ? 'any' : 'all';
	const condText = conditions
		? `${conditions} ${conditions === 1 ? 'condition' : 'conditions'} (${match})`
		: 'always';
	const actText = `${actions} ${actions === 1 ? 'action' : 'actions'}`;
	return `${condText} - ${actText}`;
}

function openCreate() {
	editingFlow.value = null;
	editorOpen.value = true;
}

function openEdit(flow: TicketFlow) {
	editingFlow.value = flow;
	editorOpen.value = true;
}

function onSaved() {
	editingFlow.value = null;
}

async function toggle(flow: TicketFlow, enabled: boolean) {
	togglingId.value = flow.id;
	try {
		await updateFlow(flow.id, { enabled });
	} catch (error) {
		toast.add({
			title: 'Failed to Update Flow',
			description: extractServerMessage(error, 'Could not update the flow. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		togglingId.value = null;
	}
}

async function remove(flow: TicketFlow) {
	if (!confirm(`Delete the flow "${flow.name}"?`)) return;
	deletingId.value = flow.id;
	try {
		await deleteFlow(flow.id);
		toast.add({
			title: 'Flow Deleted',
			description: 'The automation flow was removed.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Delete Flow',
			description: extractServerMessage(error, 'Could not delete the flow. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		deletingId.value = null;
	}
}
</script>
