<template>
	<div class="flex flex-col gap-4">
		<form
			v-if="canManage"
			class="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
			@submit.prevent="create"
		>
			<UFormField
				label="Name"
				size="sm"
				class="min-w-40 flex-1"
			>
				<UInput
					v-model="draftName"
					placeholder="Bug, Billing, Urgent..."
					class="w-full"
				/>
			</UFormField>
			<UFormField
				label="Color"
				size="sm"
			>
				<ColorPicker v-model="draftColor" />
			</UFormField>
			<UButton
				type="submit"
				color="primary"
				icon="mdi:plus"
				:loading="creating"
				:disabled="!draftName.trim()"
				>Add Label</UButton
			>
		</form>

		<div
			class="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
		>
			<div
				v-if="pending"
				class="divide-y divide-slate-100 dark:divide-slate-800"
			>
				<div
					v-for="n in 4"
					:key="n"
					class="flex items-center gap-3 px-4 py-3"
				>
					<USkeleton class="size-4 rounded-full" />
					<USkeleton class="h-4 w-40" />
				</div>
			</div>

			<div
				v-else-if="!labels.length"
				class="px-4 py-12 text-center text-sm text-slate-500"
			>
				No labels yet.
			</div>

			<div
				v-else
				class="divide-y divide-slate-100 dark:divide-slate-800"
			>
				<UContextMenu
					v-for="label in labels"
					:key="label.id"
					:items="
						labelMenu(label, { onEdit: () => startEdit(label), onDelete: () => remove(label) })
					"
				>
					<div class="flex items-center gap-3 px-4 py-3">
						<template v-if="editingId === label.id">
							<div class="flex flex-1 flex-col gap-2">
								<UInput
									v-model="editName"
									size="sm"
									class="w-full"
								/>
								<ColorPicker v-model="editColor" />
							</div>
							<UButton
								size="xs"
								color="primary"
								icon="mdi:check"
								:loading="savingId === label.id"
								@click="save(label)"
								>Save</UButton
							>
							<UButton
								size="xs"
								color="neutral"
								variant="ghost"
								icon="mdi:close"
								@click="cancelEdit"
								>Cancel</UButton
							>
						</template>
						<template v-else>
							<LabelBadge :label="label" />
							<span class="ml-auto flex items-center gap-1">
								<UTooltip
									v-if="canManage"
									text="Edit Label"
								>
									<UButton
										size="xs"
										color="neutral"
										variant="ghost"
										icon="mdi:pencil-outline"
										aria-label="Edit Label"
										@click="startEdit(label)"
									/>
								</UTooltip>
								<UTooltip
									v-if="canManage"
									text="Delete Label"
								>
									<UButton
										size="xs"
										color="error"
										variant="ghost"
										icon="mdi:delete-outline"
										aria-label="Delete Label"
										:loading="deletingId === label.id"
										@click="remove(label)"
									/>
								</UTooltip>
							</span>
						</template>
					</div>
				</UContextMenu>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { Label } from '~/shared/types/user';
import { Permission } from '~/shared/types/user';

const toast = useToast();
const { can, isAdmin } = useAuth();
const { labelMenu } = useEntityMenus();
const { labels, pending, createLabel, patchLabel, deleteLabel } = useLabels(() => ({}));

const canManage = computed(() => isAdmin.value || can(Permission.ManageLabels));

const draftName = ref('');
const draftColor = ref('#3b82f6');
const creating = ref(false);

const editingId = ref<number | null>(null);
const editName = ref('');
const editColor = ref('#3b82f6');
const savingId = ref<number | null>(null);
const deletingId = ref<number | null>(null);

async function create() {
	if (!draftName.value.trim()) return;
	creating.value = true;
	try {
		// token or hex passes through; anything empty/invalid falls back to the default
		const color = isValidLabelColor(draftColor.value) ? draftColor.value : DEFAULT_LABEL_COLOR;
		await createLabel({ name: draftName.value.trim(), color });
		draftName.value = '';
		draftColor.value = '#3b82f6';
		toast.add({
			title: 'Label Created',
			description: 'The label is now available.',
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

function startEdit(label: Label) {
	editingId.value = label.id;
	editName.value = label.name;
	editColor.value = label.color || '#3b82f6';
}

function cancelEdit() {
	editingId.value = null;
}

async function save(label: Label) {
	if (!isValidLabelColor(editColor.value)) return;
	savingId.value = label.id;
	try {
		await patchLabel(label.id, { name: editName.value.trim(), color: editColor.value });
		editingId.value = null;
		toast.add({
			title: 'Label Updated',
			description: 'Your changes were saved.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Update Label',
			description: extractServerMessage(error, 'Could not save the label. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		savingId.value = null;
	}
}

async function remove(label: Label) {
	if (!confirm(`Delete the label "${label.name}"?`)) return;
	deletingId.value = label.id;
	try {
		await deleteLabel(label.id);
		toast.add({
			title: 'Label Deleted',
			description: 'The label was removed.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Delete Label',
			description: extractServerMessage(error, 'Could not delete the label. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		deletingId.value = null;
	}
}
</script>
