<template>
	<aside
		:class="[
			'flex h-screen flex-col border-r border-slate-200 bg-white transition-all duration-200 dark:border-slate-800 dark:bg-slate-900',
			collapsed ? 'w-16' : 'w-60'
		]"
	>
		<NuxtLink
			to="/"
			class="flex h-16 items-center gap-2 border-b border-slate-200 px-4 hover:opacity-80 dark:border-slate-800"
		>
			<UIcon
				name="mdi:lifebuoy"
				class="size-7 shrink-0 text-primary-500"
			/>
			<span
				v-if="!collapsed"
				class="truncate text-lg font-semibold"
				>{{ brandName }}</span
			>
		</NuxtLink>

		<div class="p-2">
			<CommandButton
				block
				:collapsed="collapsed"
			/>
		</div>

		<nav class="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
			<NuxtLink
				v-for="item in visibleItems"
				:key="item.to"
				:to="item.to"
				:class="[
					'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
					isActive(item.to)
						? 'bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400'
						: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
				]"
			>
				<UIcon
					:name="item.icon"
					class="size-5 shrink-0"
				/>
				<span
					v-if="!collapsed"
					class="truncate"
					>{{ item.label }}</span
				>
			</NuxtLink>
		</nav>

		<div class="border-t border-slate-200 p-2 dark:border-slate-800">
			<NuxtLink
				to="/dashboard/profile"
				:class="[
					'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
				]"
			>
				<Avatar
					:avatar="user?.avatar_url"
					:id="user?.id"
					:name="user?.username"
					:role="user?.role"
					size="xs"
				/>
				<span
					v-if="!collapsed"
					class="truncate"
					>{{ user?.name || user?.username || 'Account' }}</span
				>
			</NuxtLink>
		</div>
	</aside>
</template>

<script setup lang="ts">
import { Permission } from '~/shared/types/user';

type NavItem = {
	label: string;
	to: string;
	icon: string;
	permission?: Permission;
	adminOnly?: boolean;
};

const props = withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: false });
defineEmits<{ 'update:collapsed': [value: boolean] }>();

const collapsed = computed(() => props.collapsed);

const route = useRoute();
const { user, isAdmin, can } = useAuth();
const { settings } = useSettings();

const brandName = computed(() => (settings.value?.name as string) || 'Smoke');

const items: NavItem[] = [
	{ label: 'Overview', to: '/dashboard', icon: 'mdi:view-dashboard-outline' },
	{ label: 'Tickets', to: '/dashboard/tickets', icon: 'mdi:ticket-outline' },
	{ label: 'Projects', to: '/dashboard/projects', icon: 'mdi:folder-outline' },
	{ label: 'Customers', to: '/dashboard/customers', icon: 'mdi:account-group-outline' },
	{
		label: 'Labels',
		to: '/dashboard/labels',
		icon: 'mdi:tag-multiple-outline',
		permission: Permission.ChangeLabels
	},
	{
		label: 'Users',
		to: '/dashboard/users',
		icon: 'mdi:shield-account-outline',
		permission: Permission.ManageUsers
	},
	{
		label: 'Audit Log',
		to: '/dashboard/audit',
		icon: 'mdi:clipboard-text-clock-outline',
		permission: Permission.ViewAuditLog
	},
	{
		label: 'Settings',
		to: '/dashboard/settings',
		icon: 'mdi:cog-outline',
		adminOnly: true
	}
];

const visibleItems = computed(() =>
	items.filter((item) => {
		if (item.adminOnly) return isAdmin.value || can(Permission.ManageSettings);
		if (item.permission) return isAdmin.value || can(item.permission);
		return true;
	})
);

function isActive(to: string): boolean {
	if (to === '/dashboard') return route.path === '/dashboard';
	return route.path === to || route.path.startsWith(`${to}/`);
}
</script>
