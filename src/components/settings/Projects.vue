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
					placeholder="Onboarding, Billing, Mobile App..."
					class="w-full"
				/>
			</UFormField>
			<UFormField
				label="Color"
				size="sm"
			>
				<input
					v-model="draftColor"
					type="color"
					class="h-9 w-16 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
				/>
			</UFormField>
			<UFormField
				label="Description"
				size="sm"
				class="min-w-40 flex-1"
			>
				<UInput
					v-model="draftDescription"
					placeholder="Optional summary"
					class="w-full"
				/>
			</UFormField>
			<UButton
				type="submit"
				color="primary"
				icon="mdi:plus"
				:loading="creating"
				:disabled="!draftName.trim()"
				>Add Project</UButton
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
					v-for="n in 3"
					:key="n"
					class="flex items-center gap-3 px-4 py-3"
				>
					<USkeleton class="size-4 rounded-full" />
					<USkeleton class="h-4 w-40" />
				</div>
			</div>

			<div
				v-else-if="!projects.length"
				class="px-4 py-12 text-center text-sm text-slate-500"
			>
				No projects yet.
			</div>

			<div
				v-else
				class="divide-y divide-slate-100 dark:divide-slate-800"
			>
				<div
					v-for="project in projects"
					:key="project.id"
					class="flex items-center gap-3 px-4 py-3"
				>
					<template v-if="editingId === project.id">
						<input
							v-model="editColor"
							type="color"
							class="h-8 w-12 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
						/>
						<UInput
							v-model="editName"
							size="sm"
							class="w-40"
						/>
						<UInput
							v-model="editDescription"
							size="sm"
							placeholder="Description"
							class="flex-1"
						/>
						<UButton
							size="xs"
							color="primary"
							icon="mdi:check"
							:loading="savingId === project.id"
							@click="save(project)"
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
						<span
							class="size-3 shrink-0 rounded-full border border-slate-300 dark:border-slate-600"
							:style="{ backgroundColor: project.color || '#94a3b8' }"
						/>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{{ project.name }}</p>
							<p
								v-if="project.description"
								class="truncate text-xs text-slate-500"
							>
								{{ project.description }}
							</p>
						</div>
						<span class="ml-auto flex items-center gap-1">
							<UTooltip
								v-if="canManage"
								text="Edit Project"
							>
								<UButton
									size="xs"
									color="neutral"
									variant="ghost"
									icon="mdi:pencil-outline"
									aria-label="Edit Project"
									@click="startEdit(project)"
								/>
							</UTooltip>
							<UTooltip
								v-if="canManage"
								text="Delete Project"
							>
								<UButton
									size="xs"
									color="error"
									variant="ghost"
									icon="mdi:delete-outline"
									aria-label="Delete Project"
									:loading="deletingId === project.id"
									@click="remove(project)"
								/>
							</UTooltip>
						</span>
					</template>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { Project } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';

const toast = useToast();
const { can, isAdmin } = useAuth();
const { projects, pending, createProject, updateProject, deleteProject } = useProjects();

const canManage = computed(() => isAdmin.value || can(Permission.ManageSettings));

const draftName = ref('');
const draftColor = ref('#3b82f6');
const draftDescription = ref('');
const creating = ref(false);

const editingId = ref<number | null>(null);
const editName = ref('');
const editColor = ref('#3b82f6');
const editDescription = ref('');
const savingId = ref<number | null>(null);
const deletingId = ref<number | null>(null);

async function create() {
	if (!draftName.value.trim()) return;
	creating.value = true;
	try {
		await createProject({
			name: draftName.value.trim(),
			color: draftColor.value,
			description: draftDescription.value.trim() || undefined
		});
		draftName.value = '';
		draftColor.value = '#3b82f6';
		draftDescription.value = '';
		toast.add({
			title: 'Project Created',
			description: 'The project is now available.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Create Project',
			description: extractServerMessage(error, 'Could not create the project. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		creating.value = false;
	}
}

function startEdit(project: Project) {
	editingId.value = project.id;
	editName.value = project.name;
	editColor.value = project.color || '#3b82f6';
	editDescription.value = project.description || '';
}

function cancelEdit() {
	editingId.value = null;
}

async function save(project: Project) {
	savingId.value = project.id;
	try {
		await updateProject(project.id, {
			name: editName.value.trim(),
			color: editColor.value,
			description: editDescription.value.trim() || undefined
		});
		editingId.value = null;
		toast.add({
			title: 'Project Updated',
			description: 'Your changes were saved.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Update Project',
			description: extractServerMessage(error, 'Could not save the project. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		savingId.value = null;
	}
}

async function remove(project: Project) {
	if (!confirm(`Delete the project "${project.name}"?`)) return;
	deletingId.value = project.id;
	try {
		await deleteProject(project.id);
		toast.add({
			title: 'Project Deleted',
			description: 'The project was removed.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Delete Project',
			description: extractServerMessage(error, 'Could not delete the project. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		deletingId.value = null;
	}
}
</script>
