<template>
	<div class="flex w-full flex-col gap-2">
		<div class="flex items-center gap-2">
			<UInput
				:model-value="model ?? ''"
				:disabled="disabled"
				placeholder="mdi:bug"
				class="w-full"
				@update:model-value="onInput"
			>
				<template #leading>
					<UIcon
						:name="model || 'mdi:image-outline'"
						:class="model ? 'text-default' : 'text-dimmed'"
						:style="hexStyle"
					/>
				</template>
			</UInput>
			<UButton
				v-if="model"
				color="neutral"
				variant="ghost"
				icon="mdi:close"
				size="sm"
				:disabled="disabled"
				aria-label="Clear Icon"
				@click="clear"
			/>
		</div>
		<div class="flex flex-wrap items-center gap-1">
			<UButton
				v-for="s in SUGGESTED"
				:key="s"
				:color="model === s ? 'primary' : 'neutral'"
				:variant="model === s ? 'soft' : 'subtle'"
				size="xs"
				:icon="s"
				:disabled="disabled"
				:aria-label="s"
				@click="
					() => {
						model = s;
					}
				"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
const model = defineModel<string | null>({ default: null });
const props = defineProps<{ color?: string | null; disabled?: boolean }>();

const SUGGESTED = [
	'mdi:bug',
	'mdi:lightbulb-on-outline',
	'mdi:help-circle-outline',
	'mdi:credit-card-outline',
	'mdi:cog-outline',
	'mdi:star-outline'
];

// tint the live preview icon when the ticket color is a hex value
const hexStyle = computed(() =>
	props.color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(props.color)
		? { color: props.color }
		: undefined
);

function onInput(value: string | number) {
	const next = String(value).trim();
	model.value = next || null;
}

function clear() {
	model.value = null;
}
</script>
