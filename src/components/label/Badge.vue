<template>
	<span
		class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
		:style="style"
	>
		<span
			class="size-2 rounded-full"
			:style="{ backgroundColor: dotColor }"
		/>
		{{ label.name }}
		<button
			v-if="removable"
			type="button"
			class="ml-0.5 opacity-70 hover:opacity-100"
			:aria-label="`Remove ${label.name}`"
			@click.stop="$emit('remove', label)"
		>
			<UIcon
				name="mdi:close"
				class="size-3"
			/>
		</button>
	</span>
</template>

<script setup lang="ts">
import type { Label } from '~/shared/types/user';

const props = withDefaults(defineProps<{ label: Label; removable?: boolean }>(), {
	removable: false
});
defineEmits<{ remove: [label: Label] }>();

const dotColor = computed(() => props.label.color || '#94a3b8');

// soft-tint the badge background from the label color; fall back to neutral slate
const style = computed(() => {
	const color = props.label.color || '#64748b';
	return {
		backgroundColor: `${color}1a`,
		color
	};
});
</script>
