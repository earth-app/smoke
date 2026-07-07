<template>
	<div class="mx-auto flex max-w-5xl flex-col gap-5">
		<div>
			<h1 class="text-2xl font-semibold">Customers</h1>
			<p class="text-sm text-slate-500">Everyone who has reached out to your support desk.</p>
		</div>

		<UInput
			v-model="search"
			icon="mdi:magnify"
			placeholder="Search customers"
			class="max-w-md"
		/>

		<div
			class="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
		>
			<div
				v-if="pending"
				class="divide-y divide-slate-100 dark:divide-slate-800"
			>
				<div
					v-for="n in 6"
					:key="n"
					class="flex items-center gap-3 px-4 py-3"
				>
					<USkeleton class="size-8 rounded-full" />
					<div class="flex-1 space-y-2">
						<USkeleton class="h-4 w-40" />
						<USkeleton class="h-3 w-56" />
					</div>
				</div>
			</div>

			<div
				v-else-if="!customers.length"
				class="px-4 py-16 text-center text-sm text-slate-500"
			>
				No customers found.
			</div>

			<div
				v-else
				class="divide-y divide-slate-100 dark:divide-slate-800"
			>
				<NuxtLink
					v-for="customer in customers"
					:key="customer.id"
					:to="`/dashboard/customers/${customer.id}`"
					class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
				>
					<UAvatar
						:src="customer.avatar_url"
						:alt="customer.name || customer.email"
						size="sm"
					/>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{{ customer.name || 'Unnamed Customer' }}</p>
						<p class="truncate text-xs text-slate-500">{{ customer.email }}</p>
					</div>
					<div
						v-if="customer.tags?.length"
						class="hidden flex-wrap gap-1 sm:flex"
					>
						<LabelBadge
							v-for="tag in customer.tags.slice(0, 3)"
							:key="tag.id"
							:label="tag"
						/>
					</div>
					<UIcon
						name="mdi:chevron-right"
						class="size-5 text-slate-300"
					/>
				</NuxtLink>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { QueryParameters } from '~/utils/request';

definePageMeta({ layout: 'dashboard', middleware: 'staff' });

const route = useRoute();
const router = useRouter();

const search = ref((route.query.search as string) || '');

const query = computed<QueryParameters>(() => {
	const params: QueryParameters = { limit: 100 };
	if (search.value.trim()) params.search = search.value.trim();
	return params;
});

const { customers, pending } = useCustomers(query);

watch(
	search,
	() => {
		router.replace({ query: search.value.trim() ? { search: search.value.trim() } : {} });
	},
	{ flush: 'post' }
);
</script>
