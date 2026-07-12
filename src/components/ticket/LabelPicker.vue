<template>
	<div class="flex flex-col">
		<div class="flex items-start gap-2">
			<USelectMenu
				v-model:search-term="searchTerm"
				:model-value="modelValue"
				:items="labelItems"
				value-key="value"
				multiple
				:disabled="disabled"
				:create-item="canCreate ? 'always' : false"
				placeholder="Add labels"
				class="min-w-0 flex-1"
				@update:model-value="(v) => emit('update:modelValue', v as number[])"
				@create="onCreate"
			>
				<template #item-leading="{ item }">
					<span
						class="size-2.5 rounded-full"
						:style="{
							backgroundColor: resolveColorVar((item as LabelItem).color, DEFAULT_LABEL_COLOR)
						}"
					/>
				</template>
				<template #create-item-label="{ item }"> Create label "{{ item }}" </template>
			</USelectMenu>

			<UPopover v-if="canEdit">
				<UButton
					color="neutral"
					variant="outline"
					square
					:disabled="creating"
					aria-label="New Label Color"
				>
					<span
						class="size-4 rounded-full border border-slate-300 dark:border-slate-600"
						:style="{ backgroundColor: resolveColorVar(newColor, DEFAULT_LABEL_COLOR) }"
					/>
				</UButton>
				<template #content>
					<div class="flex w-64 flex-col gap-2 p-3">
						<p class="text-xs font-semibold">New Label Color</p>
						<ColorPicker v-model="newColor" />
						<p class="text-xs text-slate-500">Applied to the next label you create.</p>
					</div>
				</template>
			</UPopover>
		</div>

		<div
			v-if="selectedLabels.length"
			class="mt-2 flex flex-wrap items-center gap-1.5"
		>
			<span
				v-for="label in selectedLabels"
				:key="label.id"
				class="inline-flex items-center gap-0.5"
			>
				<LabelBadge
					:label="label"
					:removable="!disabled"
					@remove="() => emit('update:modelValue', withoutLabelId(modelValue, label.id))"
				/>
				<UPopover
					v-if="canEdit"
					:open="editingId === label.id"
					@update:open="(o) => onEditOpen(o, label)"
				>
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						icon="mdi:palette-outline"
						:aria-label="`Edit ${label.name} Color`"
					/>
					<template #content>
						<div class="flex w-64 flex-col gap-2 p-3">
							<p class="text-xs font-semibold">Edit Label Color</p>
							<ColorPicker v-model="editColor" />
							<UButton
								size="xs"
								color="primary"
								icon="mdi:check"
								block
								:loading="savingId === label.id"
								@click="() => saveColor(label)"
								>Save</UButton
							>
						</div>
					</template>
				</UPopover>
			</span>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { Label } from '~/shared/types/user';
import { Permission } from '~/shared/types/user';

type LabelItem = { label: string; value: number; color: string };

const props = withDefaults(
	defineProps<{ modelValue: number[]; labels: Label[]; disabled?: boolean }>(),
	{ disabled: false }
);

const emit = defineEmits<{
	'update:modelValue': [number[]];
	labelsChanged: [];
}>();

const toast = useToast();
const { can, isAdmin } = useAuth();
const { createLabel, patchLabel } = useLabels();

const canManage = computed(() => isAdmin.value || can(Permission.ManageLabels));
const canEdit = computed(() => canManage.value && !props.disabled);

const searchTerm = ref('');
const newColor = ref('#3b82f6');
const creating = ref(false);

const editingId = ref<number | null>(null);
const editColor = ref('#3b82f6');
const savingId = ref<number | null>(null);

const labelItems = computed<LabelItem[]>(() =>
	props.labels.map((l) => ({ label: l.name, value: l.id, color: l.color || DEFAULT_LABEL_COLOR }))
);

const selectedLabels = computed<Label[]>(() =>
	props.modelValue.map((id) => props.labels.find((l) => l.id === id)).filter((l): l is Label => !!l)
);

const canCreate = computed(() => shouldOfferCreate(props.labels, searchTerm.value, canEdit.value));

async function onCreate(term: string) {
	const name = term.trim();
	if (!name || !canEdit.value) return;

	// dedupe: an already-existing name just gets selected, never re-created
	const existing = findLabelByName(props.labels, name);
	if (existing) {
		emit('update:modelValue', withLabelId(props.modelValue, existing.id));
		searchTerm.value = '';
		return;
	}

	creating.value = true;
	try {
		// token or hex passes through; anything empty/invalid falls back to the default
		const color = isValidLabelColor(newColor.value) ? newColor.value : DEFAULT_LABEL_COLOR;
		const label = await createLabel({ name, color });
		emit('labelsChanged');
		emit('update:modelValue', withLabelId(props.modelValue, label.id));
		searchTerm.value = '';
		newColor.value = randomLabelColor();
		toast.add({
			title: 'Label Created',
			description: `"${label.name}" is now available.`,
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Create Label',
			description: extractServerMessage(error, 'Could not create the label. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		creating.value = false;
	}
}

function onEditOpen(open: boolean, label: Label) {
	if (open) {
		editingId.value = label.id;
		editColor.value = label.color || DEFAULT_LABEL_COLOR;
	} else if (editingId.value === label.id) {
		editingId.value = null;
	}
}

async function saveColor(label: Label) {
	if (!isValidLabelColor(editColor.value)) return;
	savingId.value = label.id;
	try {
		await patchLabel(label.id, { color: editColor.value });
		emit('labelsChanged');
		editingId.value = null;
		toast.add({
			title: 'Color Updated',
			description: `"${label.name}" color saved.`,
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Update Label',
			description: extractServerMessage(error, 'Could not save the color. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		savingId.value = null;
	}
}
</script>
