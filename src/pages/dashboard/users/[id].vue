<template>
	<div class="mx-auto flex max-w-3xl flex-col gap-5">
		<UButton
			color="neutral"
			variant="ghost"
			icon="mdi:arrow-left"
			to="/dashboard/users"
			>Back</UButton
		>

		<div
			v-if="!user"
			class="space-y-3"
		>
			<USkeleton class="h-24 w-full rounded-lg" />
			<USkeleton class="h-64 w-full rounded-lg" />
		</div>

		<template v-else>
			<div
				class="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
			>
				<Avatar
					:avatar="user.avatar_url"
					:id="user.id"
					:name="displayName(user)"
					size="lg"
				/>
				<div class="min-w-0 flex-1">
					<h1 class="truncate text-xl font-semibold">{{ displayName(user) }}</h1>
					<p class="truncate text-sm text-slate-500">@{{ user.username }} · {{ user.email }}</p>
				</div>
				<UButton
					v-if="dirty && canManage"
					color="primary"
					icon="mdi:content-save-outline"
					:loading="saving"
					@click="save"
					>Save Changes</UButton
				>
			</div>

			<div
				v-if="canManage"
				class="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
			>
				<p class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Details</p>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<UFormField
						label="First Name"
						help="Shown in place of the username across the dashboard."
					>
						<UInput
							v-model="draftFirstName"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Last Name">
						<UInput
							v-model="draftLastName"
							class="w-full"
						/>
					</UFormField>
				</div>
				<div class="mt-4 flex justify-end">
					<UButton
						color="primary"
						icon="mdi:content-save-outline"
						:loading="savingNames"
						:disabled="!namesDirty"
						@click="saveNames"
						>Save Details</UButton
					>
				</div>
			</div>

			<div
				v-if="canManage"
				class="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
			>
				<p class="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Avatar</p>
				<UserAvatarPicker
					:user-id="user.id"
					:current-avatar="user.avatar_url"
					:name="user.username"
					@updated="fetchUser(true)"
				/>
			</div>

			<UserPermissionMatrix
				v-model="draftPermissions"
				:role="draftRole"
				:editable="canManage"
				@update:role="onRoleChange"
			/>

			<UserLinkedMailboxes :user-id="user.id" />
		</template>
	</div>
</template>

<script setup lang="ts">
useSeoMeta({ title: 'User' });
import { DEFAULT_PERMISSIONS, Permission, Role } from '~/shared/types/user';

definePageMeta({ layout: 'dashboard', middleware: 'admin' });

const toast = useToast();
const route = useRoute();
const { can, isAdmin } = useAuth();

const identifier = computed(() => String(route.params.id));

const { user, updateUser, fetchUser } = useUser(identifier);

const canManage = computed(() => isAdmin.value || can(Permission.ManageUsers));

const draftPermissions = ref<Permission[]>([]);
const draftRole = ref<Role>(Role.Agent);
const saving = ref(false);

const draftFirstName = ref('');
const draftLastName = ref('');
const savingNames = ref(false);

watch(
	user,
	(value) => {
		if (value) {
			draftPermissions.value = [...(value.permissions || [])];
			draftRole.value = value.role;
			draftFirstName.value = value.first_name || '';
			draftLastName.value = value.last_name || '';
		}
	},
	{ immediate: true }
);

const namesDirty = computed(
	() =>
		draftFirstName.value.trim() !== (user.value?.first_name || '') ||
		draftLastName.value.trim() !== (user.value?.last_name || '')
);

async function saveNames() {
	// a last name requires a first name (mirrors the server refine)
	if (draftLastName.value.trim() && !draftFirstName.value.trim()) {
		toast.add({
			title: 'First Name Required',
			description: 'Enter a first name before adding a last name.',
			icon: 'mdi:alert-circle',
			color: 'warning',
			duration: 4000
		});
		return;
	}
	savingNames.value = true;
	try {
		await updateUser({
			first_name: draftFirstName.value.trim() || undefined,
			last_name: draftLastName.value.trim() || undefined
		});
		toast.add({
			title: 'Details Saved',
			description: 'The name was updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Save Details',
			description: extractServerMessage(error, 'Could not save changes. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		savingNames.value = false;
	}
}

const dirty = computed(() => {
	if (!user.value) return false;
	const current = new Set(user.value.permissions || []);
	const draft = new Set(draftPermissions.value);
	const samePerms =
		current.size === draft.size && [...current].every((permission) => draft.has(permission));
	return !samePerms || user.value.role !== draftRole.value;
});

// switching role seeds its default permission set
function onRoleChange(role: Role) {
	draftRole.value = role;
	draftPermissions.value = [...DEFAULT_PERMISSIONS[role]];
}

async function save() {
	saving.value = true;
	try {
		await updateUser({ permissions: draftPermissions.value, role: draftRole.value });
		toast.add({
			title: 'User Updated',
			description: 'Role and permissions were saved.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Update User',
			description: extractServerMessage(error, 'Could not save changes. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
