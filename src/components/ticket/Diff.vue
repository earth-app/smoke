<template>
	<div
		class="whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed dark:border-slate-800 dark:bg-slate-900/60"
	>
		<template
			v-for="(op, index) in ops"
			:key="index"
		>
			<del
				v-if="op.t === 'del'"
				class="rounded bg-error/10 text-error no-underline line-through decoration-error/60"
				>{{ op.v }}</del
			>
			<ins
				v-else-if="op.t === 'ins'"
				class="rounded bg-success/15 text-success no-underline"
				>{{ op.v }}</ins
			>
			<span
				v-else
				class="text-slate-700 dark:text-slate-200"
				>{{ op.v }}</span
			>
		</template>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{ before: string; after: string }>();

const { diffWords } = useTextDiff();
const ops = computed(() => diffWords(props.before, props.after));
</script>
