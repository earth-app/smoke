<template>
	<svg
		:viewBox="`0 0 ${width} ${height}`"
		:width="width"
		:height="height"
		preserveAspectRatio="none"
		class="overflow-visible"
		role="img"
		:aria-label="ariaLabel"
	>
		<polyline
			v-if="points.length > 1"
			:points="areaPoints"
			fill="currentColor"
			class="text-primary-500/10"
			stroke="none"
		/>
		<polyline
			v-if="points.length > 1"
			:points="linePoints"
			fill="none"
			stroke="currentColor"
			class="text-primary-500"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
		<circle
			v-if="points.length"
			:cx="points[points.length - 1].x"
			:cy="points[points.length - 1].y"
			r="2.5"
			fill="currentColor"
			class="text-primary-500"
		/>
	</svg>
</template>

<script setup lang="ts">
const props = withDefaults(
	defineProps<{ data: number[]; width?: number; height?: number; label?: string }>(),
	{ width: 120, height: 36, label: 'trend' }
);

const ariaLabel = computed(() => `${props.label} sparkline`);

const points = computed(() => {
	const values = props.data;
	if (!values.length) return [] as { x: number; y: number }[];
	const max = Math.max(...values);
	const min = Math.min(...values);
	const range = max - min || 1;
	const step = values.length > 1 ? props.width / (values.length - 1) : 0;
	const pad = 3;
	const usable = props.height - pad * 2;
	return values.map((value, index) => ({
		x: index * step,
		y: pad + (usable - ((value - min) / range) * usable)
	}));
});

const linePoints = computed(() => points.value.map((p) => `${p.x},${p.y}`).join(' '));

const areaPoints = computed(() => {
	if (points.value.length < 2) return '';
	const line = points.value.map((p) => `${p.x},${p.y}`).join(' ');
	const last = points.value[points.value.length - 1];
	const first = points.value[0];
	return `${first.x},${props.height} ${line} ${last.x},${props.height}`;
});
</script>
