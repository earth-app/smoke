<template>
	<div
		class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
	>
		<div>
			<h3 class="text-sm font-semibold">Role Colors</h3>
			<p class="text-xs text-slate-500">
				Accent color applied to each role's default avatar when a staff member has no avatar of
				their own.
			</p>
		</div>

		<Skeleton
			v-if="!loaded"
			variant="avatar"
			:repeat="3"
			:gap="4"
		/>
		<div
			v-else
			class="flex flex-col gap-4"
		>
			<UFormField
				v-for="row in roles"
				:key="row.key"
				:label="row.label"
			>
				<div class="flex items-center gap-3">
					<Avatar
						:icon="roleIcon(row.key)"
						:role="row.key"
						:color="form[row.key]"
						:name="row.label"
						size="md"
					/>
					<USelect
						v-model="form[row.key]"
						:items="colorItems"
						value-key="value"
						:disabled="!canEdit(row.key)"
						class="w-full sm:w-56"
					>
						<template #leading>
							<UChip
								:color="form[row.key]"
								inset
								standalone
							/>
						</template>
					</USelect>
				</div>
			</UFormField>
		</div>

		<div class="flex justify-end">
			<UButton
				color="primary"
				icon="mdi:content-save-outline"
				:loading="saving"
				:disabled="!canEditAny"
				@click="onSave"
				>Save Role Colors</UButton
			>
		</div>
	</div>
</template>

<script setup lang="ts">
import { Role } from '~/shared/types/user';

type AvatarColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

const toast = useToast();
const { settings, loaded, save } = useSettings();
const { isAdmin, isManager } = useAuth();

const roles: { key: Role; label: string }[] = [
	{ key: Role.Agent, label: 'Agent' },
	{ key: Role.Manager, label: 'Manager' },
	{ key: Role.Admin, label: 'Admin' }
];

const colorItems: { label: string; value: AvatarColor; chip: { color: AvatarColor } }[] = [
	{ label: 'Primary', value: 'primary', chip: { color: 'primary' } },
	{ label: 'Secondary', value: 'secondary', chip: { color: 'secondary' } },
	{ label: 'Success', value: 'success', chip: { color: 'success' } },
	{ label: 'Info', value: 'info', chip: { color: 'info' } },
	{ label: 'Warning', value: 'warning', chip: { color: 'warning' } },
	{ label: 'Error', value: 'error', chip: { color: 'error' } },
	{ label: 'Neutral', value: 'neutral', chip: { color: 'neutral' } }
];

// per-role default icon shown in the preview when settings have none
const defaultRoleIcons: Record<Role, string> = {
	[Role.Agent]: 'mdi:account',
	[Role.Manager]: 'mdi:account-tie',
	[Role.Admin]: 'mdi:shield-account'
};

const form = reactive<Record<Role, AvatarColor>>({
	[Role.Agent]: 'primary',
	[Role.Manager]: 'primary',
	[Role.Admin]: 'primary'
});
const saving = ref(false);

watch(
	settings,
	(value) => {
		const colors = (value?.role_colors || {}) as Partial<Record<Role, AvatarColor>>;
		form[Role.Agent] = colors.agent || 'primary';
		form[Role.Manager] = colors.manager || 'primary';
		form[Role.Admin] = colors.admin || 'primary';
	},
	{ immediate: true }
);

// admins set every role; managers may set the agent color only
function canEdit(key: Role): boolean {
	if (isAdmin.value) return true;
	if (isManager.value) return key === Role.Agent;
	return false;
}
const canEditAny = computed(() => isManager.value || isAdmin.value);

function roleIcon(key: Role): string {
	const icons = (settings.value?.role_icons || {}) as Partial<Record<Role, string>>;
	return icons[key] || defaultRoleIcons[key];
}

async function onSave() {
	saving.value = true;
	try {
		// managers may only touch agent; admins persist all three
		const role_colors: Partial<Record<Role, AvatarColor>> = { agent: form[Role.Agent] };
		if (isAdmin.value) {
			role_colors.manager = form[Role.Manager];
			role_colors.admin = form[Role.Admin];
		}
		await save({ role_colors });
		toast.add({
			title: 'Role Colors Saved',
			description: 'Default role avatar colors were updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Save Role Colors',
			description: extractServerMessage(error, 'Could not save role colors. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
