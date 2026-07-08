<template>
	<div class="mx-auto flex max-w-5xl flex-col gap-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 class="text-2xl font-semibold">Tickets</h1>
				<p class="text-sm text-slate-500">Search, filter, and triage support requests.</p>
			</div>
			<UButton
				v-if="canCreate"
				color="primary"
				icon="mdi:plus"
				@click="createOpen = true"
				>New Ticket</UButton
			>
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<UInput
				v-model="search"
				icon="mdi:magnify"
				placeholder="Search tickets"
				class="min-w-56 flex-1"
			/>
			<USelect
				v-model="statusFilter"
				:items="statusItems"
				class="w-44"
			/>
			<USelect
				v-model="priorityFilter"
				:items="priorityItems"
				class="w-44"
			/>
			<UButton
				v-if="hasFilters"
				color="neutral"
				variant="ghost"
				icon="mdi:filter-off-outline"
				@click="clearFilters"
				>Clear</UButton
			>
		</div>

		<TicketList
			:tickets="tickets"
			:pending="pending"
		/>

		<UModal v-model:open="createOpen">
			<template #content>
				<UCard>
					<template #header>
						<h2 class="text-lg font-semibold">New Ticket</h2>
					</template>

					<UForm
						:state="form"
						class="flex flex-col gap-4"
						@submit="submitCreate"
					>
						<UFormField
							label="Title"
							name="title"
							required
						>
							<UInput
								v-model="form.title"
								placeholder="Short summary"
								class="w-full"
							/>
						</UFormField>
						<UFormField
							label="Description"
							name="description"
						>
							<UTextarea
								v-model="form.description"
								:rows="4"
								placeholder="Describe the issue"
								class="w-full"
							/>
						</UFormField>
						<UFormField
							label="Customer"
							name="customer_id"
							required
						>
							<USelectMenu
								v-model="form.customer_id"
								:items="customerItems"
								value-key="value"
								placeholder="Select a customer"
								class="w-full"
							/>
						</UFormField>
						<div class="grid grid-cols-2 gap-3">
							<UFormField
								label="Status"
								name="status"
							>
								<USelect
									v-model="form.status"
									:items="createStatusItems"
									class="w-full"
								/>
							</UFormField>
							<UFormField
								label="Priority"
								name="priority"
							>
								<USelect
									v-model="form.priority"
									:items="createPriorityItems"
									class="w-full"
								/>
							</UFormField>
						</div>
						<UFormField name="private">
							<UCheckbox
								v-model="form.private"
								label="Private Ticket"
							/>
						</UFormField>

						<div class="flex justify-end gap-2">
							<UButton
								color="neutral"
								variant="ghost"
								@click="createOpen = false"
								>Cancel</UButton
							>
							<UButton
								type="submit"
								color="primary"
								:loading="creating"
								:disabled="!form.title.trim() || !form.customer_id"
								>Create Ticket</UButton
							>
						</div>
					</UForm>
				</UCard>
			</template>
		</UModal>
	</div>
</template>

<script setup lang="ts">
import { TicketPriority, TicketStatus } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';
import type { QueryParameters } from '~/utils/request';

definePageMeta({ layout: 'dashboard', middleware: 'staff' });

const toast = useToast();
const route = useRoute();
const router = useRouter();
const { can, isAdmin } = useAuth();

const canCreate = computed(() => isAdmin.value || can(Permission.CreateTicket));

const search = ref((route.query.search as string) || '');
const statusFilter = ref((route.query.status as string) || 'all');
const priorityFilter = ref((route.query.priority as string) || 'all');

const statusItems = [
	{ label: 'All Statuses', value: 'all' },
	...Object.values(TicketStatus).map((value) => ({ label: statusLabel(value), value }))
];
const priorityItems = [
	{ label: 'All Priorities', value: 'all' },
	...Object.values(TicketPriority).map((value) => ({
		label: value.charAt(0).toUpperCase() + value.slice(1),
		value
	}))
];

const query = computed<QueryParameters>(() => {
	const params: QueryParameters = { sort: 'updated_at', sort_direction: 'desc' };
	if (search.value.trim()) params.search = search.value.trim();
	if (statusFilter.value !== 'all') params.status = statusFilter.value;
	if (priorityFilter.value !== 'all') params.priority = priorityFilter.value;
	return params;
});

const { tickets, pending } = useTickets(query);

const hasFilters = computed(
	() => !!search.value.trim() || statusFilter.value !== 'all' || priorityFilter.value !== 'all'
);

// keep filters in the url so views are shareable
watch(
	[search, statusFilter, priorityFilter],
	() => {
		const q: Record<string, string> = {};
		if (search.value.trim()) q.search = search.value.trim();
		if (statusFilter.value !== 'all') q.status = statusFilter.value;
		if (priorityFilter.value !== 'all') q.priority = priorityFilter.value;
		router.replace({ query: q });
	},
	{ flush: 'post' }
);

function clearFilters() {
	search.value = '';
	statusFilter.value = 'all';
	priorityFilter.value = 'all';
}

const createOpen = ref(false);
const creating = ref(false);
const form = reactive({
	title: '',
	description: '',
	customer_id: null as number | null,
	status: TicketStatus.Open as TicketStatus,
	priority: TicketPriority.Medium as TicketPriority,
	private: false
});

const { customers } = useCustomers(() => ({ limit: 100 }));
const { createTicket } = useTickets();

const customerItems = computed(() =>
	customers.value.map((customer) => ({
		label: customer.name ? `${customer.name} (${customer.email})` : customer.email,
		value: customer.id
	}))
);

const createStatusItems = Object.values(TicketStatus).map((value) => ({
	label: statusLabel(value),
	value
}));
const createPriorityItems = Object.values(TicketPriority).map((value) => ({
	label: value.charAt(0).toUpperCase() + value.slice(1),
	value
}));

async function submitCreate() {
	if (!form.title.trim() || !form.customer_id) return;
	creating.value = true;
	try {
		const ticket = await createTicket({
			title: form.title.trim(),
			description: form.description.trim(),
			customer_id: form.customer_id,
			status: form.status,
			priority: form.priority,
			private: form.private
		});
		createOpen.value = false;
		Object.assign(form, {
			title: '',
			description: '',
			customer_id: null,
			status: TicketStatus.Open,
			priority: TicketPriority.Medium,
			private: false
		});
		toast.add({
			title: 'Ticket Created',
			description: 'The ticket was opened.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
		await navigateTo(`/dashboard/tickets/${ticket.id}`);
	} catch {
		toast.add({
			title: 'Failed to Create Ticket',
			description: 'Could not create the ticket. Please try again.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		creating.value = false;
	}
}

function statusLabel(value: TicketStatus): string {
	return value
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}
</script>
