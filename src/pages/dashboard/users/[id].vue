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
				<UAvatar
					:src="user.avatar_url"
					:alt="user.username"
					size="lg"
				/>
				<div class="min-w-0 flex-1">
					<h1 class="truncate text-xl font-semibold">{{ user.name || user.username }}</h1>
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

			<PermissionMatrix
				v-model="draftPermissions"
				:role="draftRole"
				:editable="canManage"
				@update:role="onRoleChange"
			/>

			<LinkedMailboxes :user-id="user.id" />
		</template>
	</div>
</template>

<script setup lang="ts">
import { DEFAULT_PERMISSIONS, Permission, Role } from '~/shared/types/user';

definePageMeta({ layout: 'dashboard', middleware: 'admin' });

const toast = useToast();
const route = useRoute();
const { can, isAdmin } = useAuth();

const identifier = computed(() => String(route.params.id));

const { user, updateUser } = useUser(identifier);

const canManage = computed(() => isAdmin.value || can(Permission.ManageUsers));

const draftPermissions = ref<Permission[]>([]);
const draftRole = ref<Role>(Role.Agent);
const saving = ref(false);

watch(
	user,
	(value) => {
		if (value) {
			draftPermissions.value = [...(value.permissions || [])];
			draftRole.value = value.role;
		}
	},
	{ immediate: true }
);

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
	} catch {
		toast.add({
			title: 'Failed to Update User',
			description: 'Could not save changes. Please try again.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
