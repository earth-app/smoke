<template>
	<div class="flex flex-col gap-2">
		<div
			v-for="bar in bars"
			:key="bar.label"
			class="flex items-center gap-3"
		>
			<span class="w-28 shrink-0 truncate text-xs text-slate-500">{{ bar.label }}</span>
			<div class="h-4 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
				<div
					class="h-full rounded-full transition-all duration-500"
					:style="{ width: `${bar.percent}%`, backgroundColor: bar.color }"
				/>
			</div>
			<span class="w-8 shrink-0 text-right text-xs font-medium tabular-nums">{{ bar.value }}</span>
		</div>
		<p
			v-if="!bars.length"
			class="py-6 text-center text-sm text-slate-400"
		>
			No data to display.
		</p>
	</div>
</template>

<script setup lang="ts">
type Item = { label: string; value: number; color?: string };

const props = defineProps<{ items: Item[] }>();

const DEFAULT_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];

const bars = computed(() => {
	const max = Math.max(...props.items.map((i) => i.value), 1);
	return props.items.map((item, index) => ({
		label: item.label,
		value: item.value,
		percent: (item.value / max) * 100,
		color: item.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length]
	}));
});
</script>
