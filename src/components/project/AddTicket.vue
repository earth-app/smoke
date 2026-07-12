<template>
	<div class="flex flex-wrap items-center gap-2">
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
		<UButton
			v-if="canAttach"
			color="neutral"
			variant="outline"
			icon="mdi:link-variant"
			@click="
				() => {
					attachOpen = true;
				}
			"
			>Add Existing</UButton
		>

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
							label="Priority"
							name="priority"
						>
							<USelect
								v-model="form.priority"
								:items="createPriorityItems"
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
							label="Labels"
							name="labels"
						>
							<TicketLabelPicker
								v-model="form.labels"
								:labels="labels"
								@labels-changed="() => listLabels()"
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
								>Add to Project</UButton
							>
						</div>
					</UForm>
				</UCard>
			</template>
		</UModal>

		<UModal v-model:open="attachOpen">
			<template #content>
				<UCard>
					<template #header>
						<h2 class="text-lg font-semibold">Add Existing Ticket</h2>
					</template>

					<div class="flex flex-col gap-4">
						<UFormField
							label="Ticket"
							name="ticket"
							help="Only tickets not already in this project are shown."
						>
							<USelectMenu
								v-model="selectedTicketId"
								:items="attachItems"
								value-key="value"
								:loading="attachPending"
								placeholder="Search Tickets"
								class="w-full"
							/>
						</UFormField>

						<div class="flex justify-end gap-2">
							<UButton
								color="neutral"
								variant="ghost"
								icon="mdi:close"
								@click="
									() => {
										attachOpen = false;
									}
								"
								>Cancel</UButton
							>
							<UButton
								color="primary"
								icon="mdi:check"
								:loading="attaching"
								:disabled="!selectedTicketId"
								@click="submitAttach"
								>Add to Project</UButton
							>
						</div>
					</div>
				</UCard>
			</template>
		</UModal>
	</div>
</template>

<script setup lang="ts">
import { TicketPriority } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';
import { useTicketStore } from '~/stores/ticket';

const props = defineProps<{ projectId: number }>();
const emit = defineEmits<{ changed: [] }>();

const toast = useToast();
const { can, isAdmin } = useAuth();

const canCreate = computed(() => isAdmin.value || can(Permission.CreateTicket));
const canAttach = computed(() => isAdmin.value || can(Permission.ManageTicket));

const ticketStore = useTicketStore();
const { createTicket } = useTickets();
const { customers } = useCustomers(() => ({ limit: 100 }));
const { labels, listLabels } = useLabels(() => ({ limit: 100 }));

const createPriorityItems = prioritySelectItems();

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

const createOpen = ref(false);
const creating = ref(false);
const form = reactive({
	title: '',
	description: '',
	// 0 = None (customer-less internal ticket)
	customer_id: 0 as number,
	priority: TicketPriority.Medium as TicketPriority,
	labels: [] as number[]
});

function resetForm() {
	Object.assign(form, {
		title: '',
		description: '',
		customer_id: 0,
		priority: TicketPriority.Medium,
		labels: []
	});
}

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
		await createTicket({
			title: form.title.trim(),
			description: form.description.trim(),
			// omit customer_id for a customer-less internal ticket
			customer_id: form.customer_id > 0 ? form.customer_id : undefined,
			priority: form.priority,
			labels: form.labels.length ? form.labels : undefined,
			project_ids: [props.projectId]
		});
		createOpen.value = false;
		resetForm();
		toast.add({
			title: 'Ticket Created',
			description: 'The ticket was added to this project.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
		emit('changed');
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

const attachOpen = ref(false);
const attaching = ref(false);
const selectedTicketId = ref<number | undefined>();

// pull a broad page; the picker filters to tickets not already in this project
const {
	tickets: attachSource,
	pending: attachPending,
	listTickets: listAttachSource
} = useTickets(() => ({ limit: 100, sort: 'updated_at', sort_direction: 'desc' }));

function ticketProjectIds(ticket: {
	project_ids?: number[];
	project_id?: number | null;
}): number[] {
	return ticket.project_ids ?? (ticket.project_id != null ? [ticket.project_id] : []);
}

const eligibleTickets = computed(() =>
	attachSource.value.filter((ticket) => !ticketProjectIds(ticket).includes(props.projectId))
);

const attachItems = computed(() =>
	eligibleTickets.value.map((ticket) => ({
		label: `#${ticket.id} - ${ticket.title}`,
		value: ticket.id
	}))
);

// clear a stale selection when it leaves the eligible set (e.g. after attaching)
watch(attachOpen, (open) => {
	if (open) {
		selectedTicketId.value = undefined;
		listAttachSource();
	}
});

async function submitAttach() {
	const id = selectedTicketId.value;
	if (!id) return;
	const ticket = attachSource.value.find((t) => t.id === id);
	if (!ticket) return;
	attaching.value = true;
	try {
		const next = Array.from(new Set([...ticketProjectIds(ticket), props.projectId]));
		await ticketStore.patchTicket(id, { project_ids: next });
		attachOpen.value = false;
		selectedTicketId.value = undefined;
		toast.add({
			title: 'Ticket Added',
			description: `#${id} was added to this project.`,
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
		emit('changed');
	} catch (error) {
		toast.add({
			title: 'Failed to Add Ticket',
			description: extractServerMessage(error, 'Could not add the ticket. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		attaching.value = false;
	}
}
</script>
