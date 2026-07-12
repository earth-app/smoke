<template>
	<div
		class="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
	>
		<div
			v-if="pending"
			class="divide-y divide-slate-100 dark:divide-slate-800"
		>
			<div
				v-for="n in 5"
				:key="n"
				class="flex items-center gap-3 px-4 py-3"
			>
				<USkeleton class="size-8 rounded-full" />
				<div class="flex-1 space-y-2">
					<USkeleton class="h-4 w-40" />
					<USkeleton class="h-3 w-24" />
				</div>
				<USkeleton class="h-5 w-16 rounded-full" />
			</div>
		</div>

		<div
			v-else-if="!users.length"
			class="px-4 py-12 text-center text-sm text-slate-500"
		>
			No users found.
		</div>

		<div
			v-else
			class="divide-y divide-slate-100 dark:divide-slate-800"
		>
			<UContextMenu
				v-for="user in users"
				:key="user.id"
				:items="userMenu(user)"
			>
				<NuxtLink
					:to="`/dashboard/users/${user.id}`"
					class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
				>
					<Avatar
						:avatar="user.avatar_url"
						:id="user.id"
						:name="user.username"
						size="sm"
					/>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{{ user.name || user.username }}</p>
						<p class="truncate text-xs text-slate-500">@{{ user.username }} · {{ user.email }}</p>
					</div>
					<UBadge
						:color="roleColor(user.role) as any"
						variant="subtle"
						>{{ roleLabel(user.role) }}</UBadge
					>
					<UIcon
						name="mdi:chevron-right"
						class="size-5 text-slate-300"
					/>
				</NuxtLink>
			</UContextMenu>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { User } from '~/shared/types/user';
import { Role } from '~/shared/types/user';

withDefaults(defineProps<{ users: User[]; pending?: boolean }>(), {
	pending: false
});

const { userMenu } = useEntityMenus();

function roleLabel(role: Role): string {
	return role.charAt(0).toUpperCase() + role.slice(1);
}

function roleColor(role: Role): string {
	if (role === Role.Admin) return 'error';
	if (role === Role.Manager) return 'warning';
	return 'info';
}
</script>
