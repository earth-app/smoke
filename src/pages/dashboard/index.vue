<template>
	<div class="mx-auto flex max-w-6xl flex-col gap-6">
		<div>
			<h1 class="text-2xl font-semibold">Overview</h1>
			<p class="text-sm text-slate-500">
				Welcome back{{ user?.name ? `, ${user.name}` : '' }}. Here's your support desk at a glance.
			</p>
		</div>

		<div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
			<NuxtLink
				v-for="card in quickCards"
				:key="card.label"
				:to="card.to"
				class="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-primary-300 dark:border-slate-800 dark:bg-slate-900"
			>
				<span
					class="flex size-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400"
				>
					<UIcon
						:name="card.icon"
						class="size-5"
					/>
				</span>
				<div class="min-w-0">
					<p class="text-sm font-medium">{{ card.label }}</p>
					<p class="truncate text-xs text-slate-500">{{ card.hint }}</p>
				</div>
			</NuxtLink>
		</div>

		<AnalyticsDashboard v-if="canViewAnalytics" />
		<div
			v-else
			class="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-800"
		>
			You don't have permission to view analytics.
		</div>
	</div>
</template>

<script setup lang="ts">
import { Permission } from '~/shared/types/user';

definePageMeta({ layout: 'dashboard', middleware: 'staff' });

const { user } = useAuth();
const { can, isAdmin } = useAuth();

const canViewAnalytics = computed(() => isAdmin.value || can(Permission.ManageTicket));

const quickCards = [
	{
		label: 'Tickets',
		hint: 'Manage support requests',
		icon: 'mdi:ticket-outline',
		to: '/dashboard/tickets'
	},
	{
		label: 'Customers',
		hint: 'Browse your customers',
		icon: 'mdi:account-group-outline',
		to: '/dashboard/customers'
	},
	{
		label: 'Labels',
		hint: 'Organize with labels',
		icon: 'mdi:tag-multiple-outline',
		to: '/dashboard/labels'
	},
	{
		label: 'Profile',
		hint: 'Your account settings',
		icon: 'mdi:account-circle-outline',
		to: '/dashboard/profile'
	}
];
</script>
