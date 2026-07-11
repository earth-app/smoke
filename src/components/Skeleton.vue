<template>
	<div
		role="status"
		aria-live="polite"
		:class="[layoutClass, gapClass]"
	>
		<span class="sr-only">Loading</span>

		<template v-if="variant === 'card'">
			<div
				v-for="i in count"
				:key="i"
				class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
			>
				<div class="flex items-center gap-3">
					<USkeleton class="size-10 shrink-0 rounded-full" />
					<div class="min-w-0 flex-1 space-y-2">
						<USkeleton class="h-4 w-1/3" />
						<USkeleton class="h-3 w-2/3" />
					</div>
					<USkeleton class="h-5 w-14 shrink-0 rounded-full" />
				</div>
			</div>
		</template>

		<USkeleton
			v-for="i in count"
			v-else
			:key="i"
			:class="itemClass(i)"
			:style="itemStyle"
		/>
	</div>
</template>

<script setup lang="ts">
type SkeletonVariant = 'text' | 'line' | 'card' | 'avatar' | 'rect';

const props = withDefaults(
	defineProps<{
		variant?: SkeletonVariant;
		// how many placeholders to render (paragraph lines, list rows, cards)
		repeat?: number;
		// raw css overrides; take precedence over the variant default dimension classes
		width?: string;
		height?: string;
		// tailwind rounding class override (e.g. rounded-full)
		rounded?: string;
		// lay repeats in a row instead of a column
		inline?: boolean;
		gap?: 0 | 1 | 2 | 3 | 4 | 6 | 8;
	}>(),
	{
		variant: 'line',
		repeat: 1,
		inline: false,
		gap: 3
	}
);

const count = computed(() => Math.max(1, Math.floor(props.repeat)));

const layoutClass = computed(() =>
	props.inline ? 'flex flex-row flex-wrap items-center' : 'flex flex-col'
);

// static map; dynamic gap-${n} would not survive tailwind's source scan
const gapMap: Record<number, string> = {
	0: 'gap-0',
	1: 'gap-1',
	2: 'gap-2',
	3: 'gap-3',
	4: 'gap-4',
	6: 'gap-6',
	8: 'gap-8'
};
const gapClass = computed(() => gapMap[props.gap] ?? 'gap-3');

// varied widths so multi-line text reads like a real paragraph
const textWidths = ['w-full', 'w-11/12', 'w-5/6', 'w-3/4', 'w-2/3'];

const itemStyle = computed(() => {
	const style: Record<string, string> = {};
	if (props.width) style.width = props.width;
	if (props.height) style.height = props.height;
	return style;
});

function itemClass(index: number): string[] {
	const classes: string[] = [];

	if (props.variant === 'avatar') {
		if (!props.width && !props.height) classes.push('size-10');
		classes.push(props.rounded || 'rounded-full');
		return classes;
	}

	if (!props.height) {
		classes.push(props.variant === 'rect' ? 'h-24' : props.variant === 'text' ? 'h-3.5' : 'h-4');
	}

	if (!props.width) {
		classes.push(
			props.variant === 'text'
				? (textWidths[(index - 1) % textWidths.length] ?? 'w-full')
				: 'w-full'
		);
	}

	classes.push(props.rounded || (props.variant === 'rect' ? 'rounded-lg' : 'rounded-md'));
	return classes;
}
</script>
