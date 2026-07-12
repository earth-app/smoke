<template>
	<div class="flex flex-col gap-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<UFormField
				label="Role"
				size="sm"
			>
				<USelect
					:model-value="role"
					:items="roleItems"
					:disabled="!editable"
					class="w-40"
					@update:model-value="(v) => $emit('update:role', v as Role)"
				>
					<template #leading>
						<UIcon :name="roleIconMap[role]" />
					</template>
				</USelect>
			</UFormField>
			<p class="text-sm text-slate-500">
				{{ selectedCount }} of {{ totalCount }} permissions granted
			</p>
		</div>

		<div
			v-for="group in groups"
			:key="group.category"
			class="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
		>
			<div
				class="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800"
			>
				{{ categoryLabel(group.category) }}
			</div>
			<div class="divide-y divide-slate-100 dark:divide-slate-800">
				<div
					v-for="entry in group.entries"
					:key="entry.permission"
					class="flex items-center justify-between gap-3 px-4 py-2.5"
				>
					<div
						class="min-w-0"
						:class="{ 'opacity-60': missingPrereqs(entry.permission).length }"
					>
						<p class="text-sm font-medium">{{ permissionLabel(entry.permission) }}</p>
						<p class="text-xs text-slate-500">{{ entry.data.description }}</p>
						<p
							v-if="missingPrereqs(entry.permission).length"
							class="mt-0.5 flex items-center gap-1 text-xs text-warning"
						>
							<UIcon
								name="mdi:lock-outline"
								class="size-3.5 shrink-0"
							/>
							<span>{{ requiresLabel(entry.permission) }}</span>
						</p>
					</div>
					<UTooltip
						v-if="missingPrereqs(entry.permission).length"
						:text="requiresLabel(entry.permission)"
					>
						<USwitch
							:model-value="selected.has(entry.permission)"
							:disabled="!editable"
							@update:model-value="(v) => toggle(entry.permission, Boolean(v))"
						/>
					</UTooltip>
					<USwitch
						v-else
						:model-value="selected.has(entry.permission)"
						:disabled="!editable"
						@update:model-value="(v) => toggle(entry.permission, Boolean(v))"
					/>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { PermissionData } from '~/shared/types/user';
import {
	ALL_PERMISSIONS,
	ALL_ROLES,
	expandPermissions,
	Permission,
	PERMISSION_REQUIRES,
	Role
} from '~/shared/types/user';

const props = withDefaults(
	defineProps<{ modelValue: Permission[]; role: Role; editable?: boolean }>(),
	{ editable: false }
);

const emit = defineEmits<{
	'update:modelValue': [permissions: Permission[]];
	'update:role': [role: Role];
}>();

const selected = computed(() => new Set(props.modelValue));
const totalCount = Object.keys(ALL_PERMISSIONS).length;
const selectedCount = computed(() => props.modelValue.length);

const roleIconMap: Record<Role, string> = {
	[Role.Agent]: 'mdi:account-outline',
	[Role.Manager]: 'mdi:account-tie-outline',
	[Role.Admin]: 'mdi:shield-crown-outline'
};

const roleItems = ALL_ROLES.map((value) => ({
	label: value.charAt(0).toUpperCase() + value.slice(1),
	value,
	icon: roleIconMap[value]
}));

type Entry = { permission: Permission; data: PermissionData };
type Group = { category: PermissionData['category']; entries: Entry[] };

const groups = computed<Group[]>(() => {
	const map = new Map<PermissionData['category'], Entry[]>();
	for (const [permission, data] of Object.entries(ALL_PERMISSIONS) as [
		Permission,
		PermissionData
	][]) {
		if (!map.has(data.category)) map.set(data.category, []);
		map.get(data.category)!.push({ permission, data });
	}
	return Array.from(map.entries()).map(([category, entries]) => ({ category, entries }));
});

// direct prerequisites of a permission that are not currently granted
function missingPrereqs(permission: Permission): Permission[] {
	return (PERMISSION_REQUIRES[permission] ?? []).filter((dep) => !selected.value.has(dep));
}

function requiresLabel(permission: Permission): string {
	const names = (PERMISSION_REQUIRES[permission] ?? []).map(permissionLabel);
	return `Requires ${names.join(', ')}`;
}

// drop any permission whose prerequisites are no longer all present (cascades)
function pruneUnsatisfied(perms: Set<Permission>): Permission[] {
	let changed = true;
	while (changed) {
		changed = false;
		for (const p of [...perms]) {
			if ((PERMISSION_REQUIRES[p] ?? []).some((dep) => !perms.has(dep))) {
				perms.delete(p);
				changed = true;
			}
		}
	}
	return [...perms];
}

function toggle(permission: Permission, value: boolean) {
	if (value) {
		// enabling pulls in every transitive prerequisite so the set stays consistent
		emit('update:modelValue', expandPermissions([...props.modelValue, permission]));
		return;
	}
	// disabling also drops dependents that would be left without this prerequisite
	const next = new Set(props.modelValue);
	next.delete(permission);
	emit('update:modelValue', pruneUnsatisfied(next));
}

function permissionLabel(permission: Permission): string {
	return permission
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

function categoryLabel(category: string): string {
	return category.charAt(0).toUpperCase() + category.slice(1);
}
</script>
