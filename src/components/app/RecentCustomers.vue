<template>
	<UCard>
		<template #header>
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold">Recent Customers</h2>
				<UButton
					to="/dashboard/customers"
					variant="link"
					color="primary"
					size="xs"
					trailing-icon="mdi:arrow-right"
					>View All</UButton
				>
			</div>
		</template>

		<div
			v-if="loading"
			class="space-y-3"
		>
			<div
				v-for="i in 5"
				:key="i"
				class="flex items-center gap-3"
			>
				<Skeleton
					variant="avatar"
					width="2rem"
					height="2rem"
				/>
				<div class="min-w-0 flex-1 space-y-1.5">
					<Skeleton
						variant="line"
						width="9rem"
						height="0.875rem"
					/>
					<Skeleton
						variant="line"
						width="12rem"
						height="0.75rem"
					/>
				</div>
			</div>
		</div>

		<ul
			v-else-if="customers.length"
			class="space-y-1"
		>
			<li
				v-for="customer in customers"
				:key="customer.id"
			>
				<NuxtLink
					:to="`/dashboard/customers/${customer.id}`"
					class="flex items-center gap-3 rounded-md py-1.5 transition hover:opacity-80"
				>
					<UAvatar
						:src="customer.avatar_url || undefined"
						:alt="displayName(customer)"
						size="sm"
					/>
					<div class="min-w-0">
						<p class="truncate text-sm font-medium">{{ displayName(customer) }}</p>
						<p class="truncate text-xs text-slate-500">{{ customer.email }}</p>
					</div>
				</NuxtLink>
			</li>
		</ul>

		<div
			v-else
			class="flex flex-col items-center gap-2 py-6 text-center"
		>
			<UIcon
				name="mdi:account-group-outline"
				class="size-8 text-muted"
			/>
			<p class="text-sm text-muted">No Customers Yet</p>
		</div>
	</UCard>
</template>

<script setup lang="ts">
import type { Customer } from '~/shared/types/user';

const { customers, pending } = useCustomers(() => ({
	limit: 5,
	sort: 'created_at',
	sort_direction: 'desc'
}));

const loading = computed(() => pending.value && customers.value.length === 0);

function displayName(customer: Customer): string {
	return customer.name?.trim() || customer.email;
}
</script>
