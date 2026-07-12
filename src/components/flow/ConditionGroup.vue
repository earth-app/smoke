<template>
	<div
		:class="[
			'flex flex-col gap-3 rounded-lg border p-3',
			root
				? 'border-slate-200 dark:border-slate-800'
				: 'border-primary-200 bg-primary-50/40 dark:border-primary-900/60 dark:bg-primary-950/20'
		]"
	>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="flex items-center gap-2">
				<UIcon
					name="mdi:code-brackets"
					class="size-4 text-primary-500"
				/>
				<USelect
					v-model="matchModel"
					:items="matchItems"
					size="sm"
					class="w-44"
				/>
				<span class="text-xs text-slate-400">{{ hint }}</span>
			</div>
			<div class="flex items-center gap-1.5">
				<UButton
					color="neutral"
					variant="subtle"
					icon="mdi:plus"
					size="xs"
					@click="addCondition"
					>Add Condition</UButton
				>
				<UButton
					color="neutral"
					variant="subtle"
					icon="mdi:code-braces"
					size="xs"
					:disabled="depthValue >= maxDepth"
					@click="addGroup"
					>Add Group</UButton
				>
				<UButton
					v-if="!root"
					color="error"
					variant="ghost"
					icon="mdi:close"
					size="xs"
					aria-label="Remove Group"
					@click="emit('remove')"
				/>
			</div>
		</div>

		<p
			v-if="!group.conditions.length"
			class="text-xs text-slate-400"
		>
			No conditions. This group matches everything.
		</p>

		<div
			v-else
			class="flex flex-col gap-2 border-l-2 border-slate-200 pl-3 dark:border-slate-800"
		>
			<template
				v-for="(node, index) in group.conditions"
				:key="index"
			>
				<FlowConditionGroup
					v-if="isGroup(node)"
					:group="asGroup(node)"
					:depth="depthValue + 1"
					@remove="removeAt(index)"
				/>
				<FlowConditionRow
					v-else
					:model-value="asLeaf(node)"
					@remove="removeAt(index)"
				/>
			</template>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { FlowCondition, FlowConditionGroup, FlowConditionNode } from '~/shared/types/ticket';

// self-recursive component: named so vue resolves the <FlowConditionGroup> self-reference
defineOptions({ name: 'FlowConditionGroup' });

const props = defineProps<{ group: FlowConditionGroup; depth?: number; root?: boolean }>();
const emit = defineEmits<{ remove: [] }>();

// server caps the tree at 10; keep the ui a touch shallower so builds stay readable
const maxDepth = 6;
const depthValue = computed(() => props.depth ?? 0);

const matchItems = [
	{ label: 'Match All (And)', value: 'all' },
	{ label: 'Match Any (Or)', value: 'any' }
];

const matchModel = computed({
	get: () => props.group.match,
	set: (value) => {
		props.group.match = value;
	}
});

const hint = computed(() =>
	props.group.match === 'any' ? 'any condition passes' : 'every condition passes'
);

function isGroup(node: FlowConditionNode): node is FlowConditionGroup {
	return (node as FlowConditionGroup).kind === 'group';
}
function asGroup(node: FlowConditionNode): FlowConditionGroup {
	return node as FlowConditionGroup;
}
function asLeaf(node: FlowConditionNode): FlowCondition {
	return node as FlowCondition;
}

function addCondition() {
	props.group.conditions.push({
		kind: 'condition',
		field: 'title',
		operator: 'contains',
		value: ''
	});
}

function addGroup() {
	if (depthValue.value >= maxDepth) return;
	props.group.conditions.push({ kind: 'group', match: 'all', conditions: [] });
}

function removeAt(index: number) {
	props.group.conditions.splice(index, 1);
}
</script>
