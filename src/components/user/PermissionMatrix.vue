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
				/>
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
					<div class="min-w-0">
						<p class="text-sm font-medium">{{ permissionLabel(entry.permission) }}</p>
						<p class="text-xs text-slate-500">{{ entry.data.description }}</p>
					</div>
					<USwitch
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
import { ALL_PERMISSIONS, ALL_ROLES, Permission, Role } from '~/shared/types/user';

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

const roleItems = ALL_ROLES.map((value) => ({
	label: value.charAt(0).toUpperCase() + value.slice(1),
	value
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

function toggle(permission: Permission, value: boolean) {
	const next = new Set(props.modelValue);
	if (value) next.add(permission);
	else next.delete(permission);
	emit('update:modelValue', Array.from(next));
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
