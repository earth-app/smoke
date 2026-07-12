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
			<CommandButton />
			<template v-if="authResolving">
				<Skeleton
					variant="rect"
					width="6rem"
					height="2rem"
				/>
				<Skeleton
					variant="avatar"
					width="2rem"
					height="2rem"
				/>
			</template>
			<template v-else-if="isAuthenticated">
				<UButton
					to="/dashboard"
					color="primary"
					variant="soft"
					icon="mdi:view-dashboard-outline"
					>Dashboard</UButton
				>
				<Avatar
					:avatar="user?.avatar_url"
					:id="user?.id"
					:name="user?.username"
					:role="user?.role"
					size="sm"
				/>
			</template>
			<template v-else-if="isCustomer">
				<UButton
					to="/portal"
					color="primary"
					variant="soft"
					icon="mdi:account-circle-outline"
					>My Requests</UButton
				>
				<Avatar
					:avatar="customer?.avatar_url"
					:id="customer?.id"
					:name="customer?.name || customer?.email"
					size="sm"
				/>
			</template>
			<template v-else>
				<UButton
					to="/portal/login"
					color="neutral"
					variant="ghost"
					icon="mdi:account-circle-outline"
					>My Requests</UButton
				>
				<UButton
					to="/login"
					color="primary"
					variant="solid"
					icon="mdi:login"
					>Log In</UButton
				>
			</template>
		</div>
	</nav>
</template>

<script setup lang="ts">
const { user, isAuthenticated, sessionToken } = useAuth();
const { customer, isCustomer } = useCustomerAuth();
const { settings } = useSettings();

const brandName = computed(() => (settings.value?.name as string) || 'Smoke');

// avoid the anonymous flash: still resolving while staff auth is unknown, a staff cookie is present
// but the user isn't loaded, or (not staff) the customer session hasn't resolved yet
const authResolving = computed(
	() =>
		user.value === undefined ||
		(!!sessionToken.value && !user.value) ||
		(!isAuthenticated.value && customer.value === undefined)
);
</script>
