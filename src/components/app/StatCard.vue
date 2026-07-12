<template>
	<component
		:is="to ? 'NuxtLink' : 'div'"
		:to="to || undefined"
		class="block rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
		:class="to ? 'transition-colors hover:border-primary-300 dark:hover:border-primary-700' : ''"
	>
		<div class="flex items-center gap-2 text-slate-400">
			<UIcon
				:name="icon"
				class="size-4"
			/>
			<span class="text-xs font-medium uppercase tracking-wide">{{ label }}</span>
		</div>

		<Skeleton
			v-if="loading"
			variant="line"
			width="3.5rem"
			height="1.75rem"
			class="mt-2"
		/>
		<p
			v-else
			class="mt-2 text-2xl font-semibold tabular-nums"
		>
			{{ displayValue }}
		</p>

		<p
			v-if="hint && !loading"
			class="mt-1 truncate text-xs text-slate-500"
		>
			{{ hint }}
		</p>
	</component>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{
		label: string;
		value?: string | number | null;
		icon: string;
		hint?: string;
		to?: string;
		loading?: boolean;
	}>(),
	{ loading: false }
);

const displayValue = computed(() => {
	if (props.value === null || props.value === undefined) return '0';
	return typeof props.value === 'number' ? props.value.toLocaleString() : props.value;
});
</script>
