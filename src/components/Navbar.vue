<template>
	<nav
		class="flex h-16 items-center gap-4 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900 sm:px-6"
	>
		<NuxtLink
			to="/"
			class="flex items-center gap-2"
		>
			<UIcon
				name="mdi:lifebuoy"
				class="size-7 text-primary-500"
			/>
			<span class="text-lg font-semibold">{{ brandName }}</span>
		</NuxtLink>

		<div class="ml-auto flex items-center gap-2">
			<template v-if="isAuthenticated">
				<UButton
					to="/dashboard"
					color="primary"
					variant="soft"
					icon="mdi:view-dashboard-outline"
					>Dashboard</UButton
				>
				<UAvatar
					:src="user?.avatar_url"
					:alt="user?.username"
					size="sm"
				/>
			</template>
			<template v-else>
				<UButton
					to="/login"
					color="primary"
					variant="solid"
					>Log In</UButton
				>
			</template>
		</div>
	</nav>
</template>

<script setup lang="ts">
const { user, isAuthenticated } = useAuth();
const { settings } = useSettings();

const brandName = computed(() => (settings.value?.name as string) || 'Smoke');
</script>
