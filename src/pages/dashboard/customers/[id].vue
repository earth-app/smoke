<template>
	<div class="mx-auto flex max-w-4xl flex-col gap-5">
		<UButton
			color="neutral"
			variant="ghost"
			icon="mdi:arrow-left"
			to="/dashboard/customers"
			>Back</UButton
		>

		<div
			v-if="pending"
			class="space-y-3"
		>
			<USkeleton class="h-32 w-full rounded-lg" />
			<USkeleton class="h-40 w-full rounded-lg" />
		</div>

		<template v-else-if="customer">
			<CustomerCard
				:customer="customer"
				:editable="canEditTags"
				@edit-tags="tagsOpen = true"
			/>

			<div
				class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
			>
				<h2 class="mb-3 text-sm font-semibold">Recent Tickets</h2>
				<div
					v-if="ticketsPending"
					class="space-y-2"
				>
					<USkeleton
						v-for="n in 3"
						:key="n"
						class="h-10 w-full rounded"
					/>
				</div>
				<div
					v-else-if="!customerTickets.length"
					class="py-6 text-center text-sm text-slate-400"
				>
					No tickets from this customer.
				</div>
				<div
					v-else
					class="divide-y divide-slate-100 dark:divide-slate-800"
				>
					<NuxtLink
						v-for="ticket in customerTickets"
						:key="ticket.id"
						:to="`/dashboard/tickets/${ticket.id}`"
						class="flex items-center gap-2 py-2 hover:opacity-80"
					>
						<span class="min-w-0 flex-1 truncate text-sm">{{ ticket.title }}</span>
						<TicketStatusBadge :status="ticket.status" />
					</NuxtLink>
				</div>
			</div>
		</template>

		<div
			v-else
			class="rounded-lg border border-dashed border-slate-200 p-12 text-center text-sm text-slate-500 dark:border-slate-800"
		>
			Customer not found.
		</div>

		<UModal v-model:open="tagsOpen">
			<template #content>
				<UCard>
					<template #header>
						<h2 class="text-lg font-semibold">Edit Tags</h2>
					</template>
					<USelectMenu
						v-model="selectedTagIds"
						:items="tagItems"
						value-key="value"
						multiple
						placeholder="Select tags"
						class="w-full"
					/>
					<template #footer>
						<div class="flex justify-end gap-2">
							<UButton
								color="neutral"
								variant="ghost"
								@click="tagsOpen = false"
								>Cancel</UButton
							>
							<UButton
								color="primary"
								:loading="savingTags"
								@click="saveTags"
								>Save Tags</UButton
							>
						</div>
					</template>
				</UCard>
			</template>
		</UModal>
	</div>
</template>

<script setup lang="ts">
import type { Ticket } from '~/shared/types/ticket';
import type { Customer, Label } from '~/shared/types/user';
import { Permission } from '~/shared/types/user';

definePageMeta({ layout: 'dashboard', middleware: 'staff' });

const toast = useToast();
const route = useRoute();
const { can, isAdmin } = useAuth();

const customerId = computed(() => Number(route.params.id));

const { fetchCustomer, patchCustomer } = useCustomers();
const { labels } = useLabels(() => ({}));
const { listTickets } = useTickets();

const customer = ref<Customer | null>(null);
const pending = ref(true);
const customerTickets = ref<Ticket[]>([]);
const ticketsPending = ref(true);

const canEditTags = computed(() => isAdmin.value || can(Permission.ChangeCustomerTags));

const tagsOpen = ref(false);
const savingTags = ref(false);
const selectedTagIds = ref<number[]>([]);

const tagItems = computed(() =>
	labels.value.map((label) => ({ label: label.name, value: label.id }))
);

onMounted(async () => {
	customer.value = await fetchCustomer(customerId.value);
	selectedTagIds.value = (customer.value?.tags || []).map((tag) => tag.id);
	pending.value = false;

	const all = await listTickets({ limit: 100, sort: 'updated_at', sort_direction: 'desc' });
	customerTickets.value = all.filter((ticket) => ticket.customer_id === customerId.value);
	ticketsPending.value = false;
});

async function saveTags() {
	savingTags.value = true;
	try {
		const tags = selectedTagIds.value
			.map((id) => labels.value.find((label) => label.id === id))
			.filter((label): label is Label => !!label);
		const updated = await patchCustomer(customerId.value, { tags });
		customer.value = updated;
		tagsOpen.value = false;
		toast.add({
			title: 'Tags Updated',
			description: 'Customer tags were saved.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch {
		toast.add({
			title: 'Failed to Update Tags',
			description: 'Could not save the tags. Please try again.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		savingTags.value = false;
	}
}
</script>
