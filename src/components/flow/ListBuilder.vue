<template>
	<div class="flex w-full flex-col gap-2">
		<div class="flex flex-wrap items-center gap-1.5">
			<UBadge
				v-for="(item, index) in items"
				:key="index"
				color="neutral"
				variant="subtle"
				class="gap-1"
			>
				{{ item }}
				<button
					type="button"
					class="opacity-70 hover:opacity-100"
					:aria-label="`Remove ${item}`"
					@click="removeItem(index)"
				>
					<UIcon
						name="mdi:close"
						class="size-3"
					/>
				</button>
			</UBadge>
			<span
				v-if="!items.length"
				class="text-xs text-slate-400"
			>
				No values yet.
			</span>
		</div>
		<div class="flex items-center gap-2">
			<UInput
				v-model="draft"
				placeholder="Add a value and press Enter"
				size="sm"
				class="flex-1"
				@keydown.enter.prevent="addItem"
			/>
			<UButton
				color="neutral"
				variant="subtle"
				icon="mdi:plus"
				size="xs"
				:disabled="items.length >= 20"
				@click="addItem"
				>Add</UButton
			>
		</div>
		<p
			v-if="!valid"
			class="text-xs text-amber-500"
		>
			Enter between 2 and 20 values.
		</p>
	</div>
</template>

<script setup lang="ts">
const model = defineModel<string>({ default: '' });

const draft = ref('');

const items = computed(() =>
	model.value
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
);

const valid = computed(() => items.value.length >= 2 && items.value.length <= 20);

function commit(next: string[]) {
	model.value = next.join(', ');
}

function addItem() {
	const value = draft.value.trim();
	if (!value || items.value.length >= 20) return;
	// ignore case-insensitive duplicates
	if (items.value.some((i) => i.toLowerCase() === value.toLowerCase())) {
		draft.value = '';
		return;
	}
	commit([...items.value, value]);
	draft.value = '';
}

function removeItem(index: number) {
	commit(items.value.filter((_, i) => i !== index));
}
</script>
