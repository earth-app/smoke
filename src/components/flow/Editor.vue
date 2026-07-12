<template>
	<UModal v-model:open="open">
		<template #content>
			<UCard>
				<template #header>
					<div class="flex items-center gap-2">
						<UIcon
							name="mdi:cog-transfer-outline"
							class="size-5 text-primary-500"
						/>
						<h2 class="text-lg font-semibold">{{ isEditing ? 'Edit Flow' : 'New Flow' }}</h2>
					</div>
				</template>

				<div class="flex max-h-[65vh] flex-col gap-5 overflow-y-auto pr-1">
					<UFormField
						label="Name"
						help="A short name to recognize this rule."
					>
						<UInput
							v-model="form.name"
							placeholder="Escalate Urgent Tickets"
							class="w-full"
						/>
					</UFormField>

					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-medium">Enabled</p>
							<p class="text-xs text-slate-500">Only enabled flows run when an event fires.</p>
						</div>
						<USwitch v-model="form.enabled" />
					</div>

					<UFormField
						label="Trigger"
						help="The event that starts this flow."
					>
						<USelect
							v-model="form.trigger"
							:items="triggerItems"
							class="w-full"
						/>
					</UFormField>

					<div class="flex flex-col gap-2">
						<div>
							<h3 class="text-sm font-semibold">Conditions</h3>
							<p class="text-xs text-slate-500">
								Build a rule with nested And / Or groups. Leave empty to run on every
								{{ triggerLabel }} event.
							</p>
						</div>
						<FlowConditionGroup
							:group="form.tree"
							root
						/>
					</div>

					<div
						class="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800"
					>
						<div class="flex items-center justify-between">
							<div>
								<h3 class="text-sm font-semibold">Actions</h3>
								<p class="text-xs text-slate-500">Applied in order when the flow matches.</p>
							</div>
							<UButton
								color="neutral"
								variant="subtle"
								icon="mdi:plus"
								size="xs"
								@click="addAction"
								>Add Action</UButton
							>
						</div>
						<p
							v-if="!form.actions.length"
							class="text-xs text-rose-500"
						>
							Add at least one action.
						</p>
						<FlowActionRow
							v-for="(action, index) in form.actions"
							:key="index"
							:model-value="action"
							:trigger="form.trigger"
							:label-items="labelItems"
							@update:model-value="
								(v: FlowAction) => {
									form.actions[index] = v;
								}
							"
							@remove="removeAction(index)"
						/>
					</div>
				</div>

				<template #footer>
					<div class="flex justify-end gap-2">
						<UButton
							color="neutral"
							variant="ghost"
							@click="
								() => {
									open = false;
								}
							"
							>Cancel</UButton
						>
						<UButton
							color="primary"
							icon="mdi:content-save-outline"
							:loading="saving"
							@click="onSave"
							>{{ isEditing ? 'Save Flow' : 'Create Flow' }}</UButton
						>
					</div>
				</template>
			</UCard>
		</template>
	</UModal>
</template>

<script setup lang="ts">
import type {
	FlowAction,
	FlowCondition,
	FlowConditionGroup,
	FlowConditionNode,
	TicketFlow
} from '~/shared/types/ticket';
import { TicketPriority } from '~/shared/types/ticket';

const props = defineProps<{ flow?: TicketFlow | null }>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ saved: [] }>();

const toast = useToast();
const { createFlow, updateFlow } = useFlows();
const { labels } = useLabels(() => ({}));

const isEditing = computed(() => !!props.flow);

type FlowForm = {
	name: string;
	enabled: boolean;
	trigger: TicketFlow['trigger'];
	// always edited as a single root group; a flat rule is a root group of leaves
	tree: FlowConditionGroup;
	actions: FlowAction[];
};

const form = reactive<FlowForm>(blankForm());
const saving = ref(false);

const triggerItems = [
	{ label: 'Ticket Created', value: 'ticket.created', icon: 'mdi:ticket-outline' },
	{ label: 'Ticket Updated', value: 'ticket.updated', icon: 'mdi:pencil-outline' },
	{ label: 'New Message', value: 'ticket.message', icon: 'mdi:message-text-outline' },
	{ label: 'Ticket Deleted', value: 'ticket.deleted', icon: 'mdi:trash-can-outline' },
	{ label: 'Customer Created', value: 'customer.created', icon: 'mdi:account-plus-outline' },
	{ label: 'Customer Added', value: 'customer.added', icon: 'mdi:account-arrow-right-outline' },
	{ label: 'Label Added', value: 'label.added', icon: 'mdi:tag-plus-outline' },
	{ label: 'Label Removed', value: 'label.removed', icon: 'mdi:tag-minus-outline' },
	{ label: 'Assignee Added', value: 'assignee.added', icon: 'mdi:account-check-outline' },
	{ label: 'Assignee Removed', value: 'assignee.removed', icon: 'mdi:account-remove-outline' },
	{ label: 'Label Created', value: 'label.created', icon: 'mdi:tag-outline' },
	{ label: 'Label Updated', value: 'label.updated', icon: 'mdi:tag-edit-outline' },
	{ label: 'Label Deleted', value: 'label.deleted', icon: 'mdi:tag-off-outline' },
	{ label: 'Agent Created', value: 'agent.created', icon: 'mdi:account-tie-outline' },
	{ label: 'Agent Updated', value: 'agent.updated', icon: 'mdi:account-edit-outline' },
	{ label: 'Agent Deleted', value: 'agent.deleted', icon: 'mdi:account-off-outline' }
];

const labelItems = computed(() =>
	labels.value.map((l) => ({ label: l.name, value: String(l.id) }))
);

const triggerLabel = computed(
	() => triggerItems.find((t) => t.value === form.trigger)?.label ?? form.trigger
);

function blankForm(): FlowForm {
	return {
		name: '',
		enabled: true,
		trigger: 'ticket.created',
		tree: { kind: 'group', match: 'all', conditions: [] },
		actions: [{ type: 'set_priority', value: TicketPriority.High }]
	};
}

function isGroupNode(node: FlowConditionNode): node is FlowConditionGroup {
	return (node as FlowConditionGroup).kind === 'group';
}

// deep copy a tree so edits don't mutate the stored flow object
function cloneTree(group: FlowConditionGroup): FlowConditionGroup {
	return {
		kind: 'group',
		match: group.match === 'any' ? 'any' : 'all',
		conditions: (group.conditions ?? []).map((node) =>
			isGroupNode(node)
				? cloneTree(node)
				: { kind: 'condition', field: node.field, operator: node.operator, value: node.value }
		)
	};
}

// wrap legacy flat conditions in a single root group so old flows edit as a tree
function treeFromFlat(conditions: FlowCondition[], match: 'all' | 'any'): FlowConditionGroup {
	return {
		kind: 'group',
		match,
		conditions: conditions.map((c) => ({
			kind: 'condition',
			field: c.field,
			operator: c.operator,
			value: c.value
		}))
	};
}

// a rule is "flat" when the root has no nested groups (only direct leaves)
function hasNestedGroup(group: FlowConditionGroup): boolean {
	return group.conditions.some(isGroupNode);
}

// the root's direct leaves, for the legacy conditions field + the list summary
function directLeaves(group: FlowConditionGroup): FlowCondition[] {
	return group.conditions
		.filter((node) => !isGroupNode(node))
		.map((node) => {
			const leaf = node as FlowCondition;
			return { field: leaf.field, operator: leaf.operator, value: leaf.value };
		});
}

function addAction() {
	form.actions.push({ type: 'set_priority', value: TicketPriority.High });
}

function removeAction(index: number) {
	form.actions.splice(index, 1);
}

function seed() {
	const flow = props.flow;
	if (flow) {
		form.name = flow.name;
		form.enabled = flow.enabled;
		form.trigger = flow.trigger;
		form.tree = flow.condition_tree
			? cloneTree(flow.condition_tree)
			: treeFromFlat(flow.conditions ?? [], flow.match);
		form.actions = flow.actions.map((a) => ({ ...a }));
	} else {
		Object.assign(form, blankForm());
	}
}

watch(open, (value) => {
	if (value) seed();
});

async function onSave() {
	if (!form.name.trim()) {
		toast.add({
			title: 'Name Required',
			description: 'Give the flow a name before saving.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 3000
		});
		return;
	}
	if (!form.actions.length) {
		toast.add({
			title: 'Action Required',
			description: 'Add at least one action to the flow.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 3000
		});
		return;
	}

	saving.value = true;
	// nested rules ship the tree; flat rules clear any stored tree (null) and use conditions/match.
	// conditions carries the root's direct leaves either way so the list summary stays populated
	const nested = hasNestedGroup(form.tree);
	const payload = {
		name: form.name.trim(),
		enabled: form.enabled,
		trigger: form.trigger,
		match: form.tree.match,
		conditions: directLeaves(form.tree),
		condition_tree: nested ? cloneTree(form.tree) : null,
		actions: form.actions
	};

	try {
		if (props.flow) {
			await updateFlow(props.flow.id, payload);
		} else {
			await createFlow(payload);
		}
		toast.add({
			title: props.flow ? 'Flow Updated' : 'Flow Created',
			description: 'Your automation flow was saved.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
		open.value = false;
		emit('saved');
	} catch (error) {
		toast.add({
			title: 'Failed to Save Flow',
			description: extractServerMessage(error, 'Could not save the flow. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
