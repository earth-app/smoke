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
				@click="
					() => {
						createOpen = true;
					}
				"
				>New Ticket</UButton
			>
		</div>

		<UTabs
			v-model="view"
			:items="viewItems"
			:content="false"
			color="primary"
		/>

		<div class="flex flex-wrap items-center gap-3">
			<UInput
				v-model="search"
				icon="mdi:magnify"
				placeholder="Search tickets"
				class="min-w-56 flex-1"
			/>
			<USelectMenu
				v-model="projectFilter"
				:items="projectItems"
				value-key="value"
				class="w-48"
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
			:tickets="visibleTickets"
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
							required
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
							help="Leave as None to open an internal ticket with no customer."
						>
							<USelectMenu
								v-model="form.customer_id"
								:items="customerItems"
								value-key="value"
								placeholder="Select a customer"
								class="w-full"
							/>
						</UFormField>
						<UFormField
							label="Projects"
							name="project_ids"
						>
							<TicketProjectSelect v-model="form.project_ids" />
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
								icon="mdi:close"
								@click="
									() => {
										createOpen = false;
									}
								"
								>Cancel</UButton
							>
							<UButton
								type="submit"
								color="primary"
								icon="mdi:check"
								:loading="creating"
								:disabled="!form.title.trim() || !form.description.trim()"
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
useSeoMeta({ title: 'Tickets' });
import type { ContextMenuItem } from '@nuxt/ui';
import type { Ticket } from '~/shared/types/ticket';
import { TicketPriority, TicketStatus } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';
import type { QueryParameters } from '~/utils/request';

definePageMeta({ layout: 'dashboard', middleware: 'staff' });

const toast = useToast();
const route = useRoute();
const router = useRouter();
const { can, isAdmin, user } = useAuth();

const canCreate = computed(() => isAdmin.value || can(Permission.CreateTicket));

const search = ref((route.query.search as string) || '');
const statusFilter = ref((route.query.status as string) || 'all');
const priorityFilter = ref((route.query.priority as string) || 'all');
// saved view + project filter
const view = ref((route.query.view as string) || 'all');
const projectFilter = ref((route.query.project as string) || 'all');

const { projects } = useProjects();

const viewItems = [
	{ label: 'All', value: 'all' },
	{ label: 'Assigned to Me', value: 'assigned' },
	{ label: 'My Submitted', value: 'submitted' }
];

const projectItems = computed(() => [
	{ label: 'All Projects', value: 'all' },
	{ label: 'No Project', value: 'none' },
	...projects.value.map((project) => ({ label: project.name, value: String(project.id) }))
]);

const statusItems = [
	{ label: 'All Statuses', value: 'all', icon: 'mdi:filter-variant' },
	...statusSelectItems()
];
const priorityItems = [
	{ label: 'All Priorities', value: 'all', icon: 'mdi:filter-variant' },
	...prioritySelectItems()
];

// only the free-text search + sort run server-side; the view/project/status/priority
// filters are applied over the fetched page so they compose without extra round-trips
const query = computed<QueryParameters>(() => {
	const params: QueryParameters = { sort: 'updated_at', sort_direction: 'desc', limit: 100 };
	if (search.value.trim()) params.search = search.value.trim();
	return params;
});

const { tickets, pending, listTickets } = useTickets(query);

const visibleTickets = computed<Ticket[]>(() => {
	return tickets.value.filter((ticket) => {
		if (statusFilter.value !== 'all' && ticket.status !== statusFilter.value) return false;
		if (priorityFilter.value !== 'all' && ticket.priority !== priorityFilter.value) return false;

		if (view.value === 'assigned') {
			if (!user.value || !ticket.assignees.some((assignee) => assignee.id === user.value?.id))
				return false;
		} else if (view.value === 'submitted') {
			// no creator column exists, so a staff "submission" is modeled as a customer-less
			// internal ticket (customer_id === 0) — the internal-ticket flow this feature adds
			if (ticket.customer_id !== 0) return false;
		}

		const ticketProjectIds =
			ticket.project_ids ?? (ticket.project_id != null ? [ticket.project_id] : []);
		if (projectFilter.value === 'none') {
			if (ticketProjectIds.length > 0) return false;
		} else if (projectFilter.value !== 'all') {
			if (!ticketProjectIds.includes(Number(projectFilter.value))) return false;
		}

		return true;
	});
});

const hasFilters = computed(
	() =>
		!!search.value.trim() ||
		statusFilter.value !== 'all' ||
		priorityFilter.value !== 'all' ||
		view.value !== 'all' ||
		projectFilter.value !== 'all'
);

// keep filters in the url so views are shareable
watch(
	[search, statusFilter, priorityFilter, view, projectFilter],
	() => {
		const q: Record<string, string> = {};
		if (search.value.trim()) q.search = search.value.trim();
		if (statusFilter.value !== 'all') q.status = statusFilter.value;
		if (priorityFilter.value !== 'all') q.priority = priorityFilter.value;
		if (view.value !== 'all') q.view = view.value;
		if (projectFilter.value !== 'all') q.project = projectFilter.value;
		router.replace({ query: q });
	},
	{ flush: 'post' }
);

function clearFilters() {
	search.value = '';
	statusFilter.value = 'all';
	priorityFilter.value = 'all';
	view.value = 'all';
	projectFilter.value = 'all';
}

const createOpen = ref(false);
const creating = ref(false);
const form = reactive({
	title: '',
	description: '',
	// 0 = None (customer-less internal ticket)
	customer_id: 0 as number,
	project_ids: [] as number[],
	status: TicketStatus.Open as TicketStatus,
	priority: TicketPriority.Medium as TicketPriority,
	private: false
});

const { customers } = useCustomers(() => ({ limit: 100 }));
const { createTicket } = useTickets();

const customerItems = computed(() => [
	{ label: 'None (Internal Ticket)', value: 0 },
	...customers.value.map((customer) => ({
		label: customer.name
			? customer.email
				? `${customer.name} (${customer.email})`
				: customer.name
			: customer.email || `Customer #${customer.id}`,
		value: customer.id
	}))
]);

const createStatusItems = statusSelectItems();
const createPriorityItems = prioritySelectItems();

async function submitCreate() {
	if (!form.title.trim() || !form.description.trim()) {
		toast.add({
			title: 'Missing Details',
			description: 'A title and description are required.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
		return;
	}
	creating.value = true;
	try {
		const ticket = await createTicket({
			title: form.title.trim(),
			description: form.description.trim(),
			// omit customer_id for a customer-less internal ticket
			customer_id: form.customer_id > 0 ? form.customer_id : undefined,
			project_ids: form.project_ids.length ? form.project_ids : undefined,
			status: form.status,
			priority: form.priority,
			private: form.private
		});
		createOpen.value = false;
		Object.assign(form, {
			title: '',
			description: '',
			customer_id: 0,
			project_ids: [],
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
	} catch (error) {
		toast.add({
			title: 'Failed to Create Ticket',
			description: extractServerMessage(error, 'Could not create the ticket. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		creating.value = false;
	}
}

// the palette's "New Ticket" command routes here with ?new=1; open the modal then strip the query
// so a refresh doesn't reopen it. handles both first mount and a query change while already here
function maybeOpenCreate() {
	if (route.query.new !== '1') return;
	createOpen.value = true;
	const q = { ...route.query };
	delete q.new;
	router.replace({ query: q });
}
onMounted(maybeOpenCreate);
watch(() => route.query.new, maybeOpenCreate);

// page context menu: new ticket, quick view switch, clear filters, refresh
setPageMenu(() => {
	const actions: ContextMenuItem[] = [];
	if (canCreate.value)
		actions.push({
			label: 'New Ticket',
			icon: 'mdi:plus-circle-outline',
			kbds: ['n'],
			onSelect: () => {
				createOpen.value = true;
			}
		});
	actions.push({
		label: 'Refresh Tickets',
		icon: 'mdi:refresh',
		onSelect: () => listTickets(query.value)
	});
	if (hasFilters.value)
		actions.push({
			label: 'Clear Filters',
			icon: 'mdi:filter-off-outline',
			onSelect: clearFilters
		});

	const views: ContextMenuItem = {
		label: 'Switch View',
		icon: 'mdi:eye-outline',
		children: viewItems.map((item) => ({
			label: item.label,
			onSelect: () => {
				view.value = item.value;
			}
		}))
	};

	return [actions, [views]];
});
</script>
