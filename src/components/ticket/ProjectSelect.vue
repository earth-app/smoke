<template>
	<div class="flex flex-col gap-2">
		<USelectMenu
			:model-value="selected"
			:items="items"
			value-key="value"
			multiple
			:disabled="disabled"
			:placeholder="placeholder"
			class="w-full"
			@update:model-value="onUpdate"
		/>
		<div
			v-if="selectedProjects.length"
			class="flex flex-wrap gap-1"
		>
			<span
				v-for="project in selectedProjects"
				:key="project.id"
				class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
				:style="chipStyle(project)"
			>
				<span
					class="size-2 rounded-full"
					:style="{ backgroundColor: project.color || '#94a3b8' }"
				/>
				{{ project.name }}
			</span>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { Project } from '~/shared/types/ticket';

const props = withDefaults(
	defineProps<{
		modelValue?: number[];
		placeholder?: string;
		disabled?: boolean;
	}>(),
	{ modelValue: () => [], placeholder: 'No Projects', disabled: false }
);

const emit = defineEmits<{ 'update:modelValue': [value: number[]] }>();

const { projects } = useProjects();

const items = computed(() =>
	projects.value.map((project) => ({ label: project.name, value: project.id }))
);

const selected = computed(() => props.modelValue ?? []);

const selectedProjects = computed<Project[]>(() =>
	selected.value
		.map((id) => projects.value.find((project) => project.id === id))
		.filter((project): project is Project => !!project)
);

function onUpdate(value: number[]) {
	emit('update:modelValue', value);
}

// soft-tint the chip bg from the project color; fall back to neutral slate
function chipStyle(project: Project) {
	const color = project.color || '#64748b';
	return { backgroundColor: `${color}1a`, color };
}
</script>
