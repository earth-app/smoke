<template>
	<span
		class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
		:style="style"
	>
		<span
			class="size-2 rounded-full"
			:style="{ backgroundColor: resolved }"
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

// resolves a nuxt token or css hex into a usable color; neutral fallback when unset
const resolved = computed(() => resolveColorVar(props.label.color, DEFAULT_LABEL_COLOR));

// soft-tint the badge from the resolved color; color-mix stays token-safe
const style = computed(() => ({
	backgroundColor: `color-mix(in srgb, ${resolved.value} 12%, transparent)`,
	color: resolved.value
}));
</script>
