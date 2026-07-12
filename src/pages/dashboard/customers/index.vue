<template>
	<div class="mx-auto flex max-w-5xl flex-col gap-5">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h1 class="text-2xl font-semibold">Customers</h1>
				<p class="text-sm text-slate-500">Everyone who has reached out to your support desk.</p>
			</div>
			<UButton
				v-if="canManageCustomers"
				color="primary"
				icon="mdi:account-plus-outline"
				@click="openCreate"
			>
				New Customer
			</UButton>
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
				<UContextMenu
					v-for="customer in customers"
					:key="customer.id"
					:items="customerMenu(customer)"
				>
					<NuxtLink
						:to="`/dashboard/customers/${customer.id}`"
						class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
					>
						<Avatar
							:avatar="customer.avatar_url"
							:name="customer.name || customer.email"
							size="sm"
						/>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{{ customer.name || 'Unnamed Customer' }}</p>
							<p class="truncate text-xs text-slate-500">{{ customer.email || 'No Email' }}</p>
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
				</UContextMenu>
			</div>
		</div>

		<UModal v-model:open="createOpen">
			<template #content>
				<UCard>
					<template #header>
						<h2 class="text-lg font-semibold">New Customer</h2>
					</template>
					<div class="flex flex-col gap-4">
						<UFormField
							label="Name"
							name="name"
						>
							<UInput
								v-model="form.name"
								icon="mdi:account-outline"
								placeholder="Jane Doe"
								class="w-full"
							/>
						</UFormField>
						<UFormField
							label="Email"
							name="email"
							hint="Optional"
						>
							<UInput
								v-model="form.email"
								type="email"
								icon="mdi:email-outline"
								placeholder="jane@example.com"
								class="w-full"
							/>
						</UFormField>
						<UFormField
							label="Tags"
							name="tags"
							hint="Optional"
						>
							<USelectMenu
								v-model="form.tagIds"
								:items="tagItems"
								value-key="value"
								icon="mdi:tag-multiple-outline"
								multiple
								placeholder="Select tags"
								class="w-full"
							/>
						</UFormField>
					</div>
					<template #footer>
						<div class="flex justify-end gap-2">
							<UButton
								color="neutral"
								variant="ghost"
								icon="mdi:close"
								@click="
									() => {
										createOpen = false;
									}
								"
							>
								Cancel
							</UButton>
							<UButton
								color="primary"
								icon="mdi:content-save-outline"
								:loading="saving"
								:disabled="!canSubmit"
								@click="submitCreate"
							>
								Create Customer
							</UButton>
						</div>
					</template>
				</UCard>
			</template>
		</UModal>
	</div>
</template>

<script setup lang="ts">
useSeoMeta({ title: 'Customers' });
import type { ContextMenuItem } from '@nuxt/ui';
import type { Customer, Label } from '~/shared/types/user';
import { Permission } from '~/shared/types/user';
import type { QueryParameters } from '~/utils/request';

definePageMeta({ layout: 'dashboard', middleware: 'staff' });

const toast = useToast();
const route = useRoute();
const router = useRouter();
const { can, isAdmin } = useAuth();
const { customerMenu } = useEntityMenus();

const search = ref((route.query.search as string) || '');

const query = computed<QueryParameters>(() => {
	const params: QueryParameters = { limit: 100 };
	if (search.value.trim()) params.search = search.value.trim();
	return params;
});

const { customers, pending, listCustomers, createCustomer } = useCustomers(query);
const { labels } = useLabels(() => ({}));

const canManageCustomers = computed(() => isAdmin.value || can(Permission.ManageCustomers));

const tagItems = computed(() =>
	labels.value.map((label) => ({ label: label.name, value: label.id }))
);

const createOpen = ref(false);
const saving = ref(false);
const form = reactive<{ name: string; email: string; tagIds: number[] }>({
	name: '',
	email: '',
	tagIds: []
});

const canSubmit = computed(() => form.name.trim().length > 0);

function openCreate() {
	form.name = '';
	form.email = '';
	form.tagIds = [];
	createOpen.value = true;
}

async function submitCreate() {
	if (!canSubmit.value) return;
	saving.value = true;
	try {
		const tags = form.tagIds
			.map((id) => labels.value.find((label) => label.id === id))
			.filter((label): label is Label => !!label);
		const body: Partial<Customer> = { name: form.name.trim(), tags };
		if (form.email.trim()) body.email = form.email.trim();
		await createCustomer(body);
		createOpen.value = false;
		await listCustomers();
		toast.add({
			title: 'Customer Created',
			description: 'The customer was added to your desk.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Create Customer',
			description: extractServerMessage(error, 'Could not create the customer. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}

watch(
	search,
	() => {
		router.replace({ query: search.value.trim() ? { search: search.value.trim() } : {} });
	},
	{ flush: 'post' }
);

// palette "New Customer" command deep-links here with ?new=1
onMounted(() => {
	if (route.query.new !== '1') return;
	if (canManageCustomers.value) openCreate();
	router.replace({ query: {} });
});

setPageMenu(() => {
	const actions: ContextMenuItem[] = [];
	if (canManageCustomers.value)
		actions.push({ label: 'New Customer', icon: 'mdi:account-plus-outline', onSelect: openCreate });
	actions.push({
		label: 'Refresh Customers',
		icon: 'mdi:refresh',
		onSelect: () => listCustomers()
	});
	return [actions];
});
</script>
