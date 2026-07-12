<template>
	<div class="space-y-2">
		<div class="flex items-center gap-2">
			<span
				class="size-7 shrink-0 rounded-full border border-default"
				:style="{ backgroundColor: preview }"
			/>
			<span class="text-xs text-muted">{{ selectedLabel }}</span>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<button
				v-for="c in NUXT_COLORS"
				:key="c"
				type="button"
				class="size-6 rounded-full ring-2 ring-offset-2 ring-offset-default transition hover:scale-110"
				:class="modelValue === c ? 'ring-inverted' : 'ring-transparent'"
				:style="{ backgroundColor: `var(--ui-color-${c}-500)` }"
				:title="titleize(c)"
				@click="emit('update:modelValue', c)"
			/>

			<label
				class="relative flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-default"
				:class="custom ? 'ring-inverted' : 'ring-transparent'"
				:style="custom ? { backgroundColor: resolveColorVar(modelValue) } : {}"
				title="Custom Color"
			>
				<UIcon
					v-if="!custom"
					name="mdi:eyedropper-variant"
					class="size-3.5 text-muted"
				/>
				<input
					type="color"
					class="absolute inset-0 cursor-pointer opacity-0"
					:value="customHex"
					@input="onPick"
				/>
			</label>

			<UButton
				v-if="clearable && modelValue"
				icon="mdi:close"
				size="xs"
				variant="ghost"
				color="neutral"
				title="Clear"
				@click="emit('update:modelValue', '')"
			/>
		</div>

		<UInput
			:model-value="hexInput"
			placeholder="#3B82F6"
			size="sm"
			class="w-32 font-mono"
			@update:model-value="onHex"
		/>
	</div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ modelValue?: string; clearable?: boolean }>(), {
	clearable: false
});
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

// true when the bound value is a css hex/rgb rather than a nuxt token
const custom = computed(() => isCustomColor(props.modelValue));
const customHex = computed(() => (custom.value ? (props.modelValue as string) : '#3b82f6'));

const preview = computed(() => resolveColorVar(props.modelValue, 'var(--ui-bg-elevated)'));
const selectedLabel = computed(() => {
	const v = props.modelValue;
	if (!v) return 'No Color Selected';
	if (isNuxtColor(v)) return titleize(v);
	if (isCustomColor(v)) return v.toUpperCase();
	return 'No Color Selected';
});

// local text mirror so typing a partial hex is not clobbered by the controlled reset
const hexInput = ref(isCustomColor(props.modelValue) ? (props.modelValue as string) : '');
watch(
	() => props.modelValue,
	(v) => {
		if (isNuxtColor(v)) hexInput.value = '';
		else if (isCustomColor(v)) hexInput.value = v as string;
		else if (!v) hexInput.value = '';
	}
);

function titleize(v: string) {
	return v.charAt(0).toUpperCase() + v.slice(1);
}

function onPick(e: Event) {
	emit('update:modelValue', (e.target as HTMLInputElement).value);
}
function onHex(v: string | number) {
	const s = String(v);
	hexInput.value = s;
	emit('update:modelValue', s.trim());
}
</script>
