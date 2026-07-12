<template>
	<div class="mx-auto flex max-w-6xl flex-col gap-5">
		<div class="flex items-center gap-3">
			<UButton
				color="neutral"
				variant="ghost"
				icon="mdi:arrow-left"
				to="/dashboard/tickets"
				>Back</UButton
			>
		</div>

		<div class="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
			<div class="flex min-w-0 flex-col gap-4">
				<TicketDeletionBanner
					v-if="ticket"
					:ticket="ticket"
				/>
				<TicketConversation
					v-if="ticket"
					:header="headerData"
					:messages="messages"
					:events="events"
					:pending="threadPending"
					:locked="ticket.locked"
					:archived="ticket.archived"
					:can-reply="canReply"
				>
					<template #actions>
						<TicketLockControls
							:ticket="ticket"
							@changed="fetchThread(true)"
						/>
					</template>
					<template #reply>
						<TicketMessageComposer
							ref="composer"
							:sending="sending"
							:default-identity="defaultIdentity"
							:ticket-id="ticket?.id"
							@send="onSend"
						/>
					</template>
				</TicketConversation>
			</div>

			<TicketSidebar
				v-if="ticket"
				:ticket="ticket"
				:customer="customer"
				:labels="labels"
				:users="users"
				@patch="onPatch"
				@labels-changed="listLabels()"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
useSeoMeta({ title: 'Ticket' });
import type { Ticket, TicketAttachmentInput, TicketPatchInput } from '~/shared/types/ticket';
import type { Customer, User } from '~/shared/types/user';
import { Permission } from '~/shared/types/user';
import { useUserStore } from '~/stores/user';

definePageMeta({ layout: 'dashboard', middleware: 'staff' });

const toast = useToast();
const route = useRoute();
const { can, isAdmin } = useAuth();
const userStore = useUserStore();

const ticketId = computed(() => Number(route.params.id));

const { ticket, messages, events, fetchThread, patchTicket, reply } = useTicket(ticketId);
const { labels, listLabels } = useLabels(() => ({}));
const { fetchCustomer } = useCustomers();

const threadPending = ref(true);
const sending = ref(false);
const composer = ref<{ reset: () => void } | null>(null);

const customer = ref<Customer | null>(null);
const createdByUser = ref<User | null>(null);
const users = ref<User[]>([]);

const canReply = computed(() => isAdmin.value || can(Permission.ReplyTicket));
const defaultIdentity = computed<'self' | 'team'>(() => 'team');

// resolve the creator so a customer-less agent-created ticket shows the agent, not "Guest"
const creator = computed<{ name?: string; email?: string; staff?: boolean } | undefined>(() => {
	if (customer.value)
		return { name: customer.value.name, email: customer.value.email, staff: false };
	const u = createdByUser.value;
	if (ticket.value?.created_by && u) return { name: displayName(u) || u.username, staff: true };
	return undefined;
});

const headerData = computed(() => ({ ...(ticket.value as Ticket), creator: creator.value }));

onMounted(async () => {
	await fetchThread(true).finally(() => {
		threadPending.value = false;
	});
	users.value = await userStore.listUsers({ limit: 100 });
});

watch(
	ticket,
	async (value) => {
		if (value?.customer_id) {
			customer.value = await fetchCustomer(value.customer_id);
		} else if (value?.created_by) {
			createdByUser.value = await userStore.fetchUser(String(value.created_by));
		}
	},
	{ immediate: true }
);

async function onSend(payload: {
	message: string;
	identity: 'self' | 'team';
	attachments: TicketAttachmentInput[];
	cc: string[];
}) {
	sending.value = true;
	try {
		await reply({
			message: payload.message,
			identity: payload.identity,
			attachments: payload.attachments,
			cc: payload.cc
		});
		composer.value?.reset();
		toast.add({
			title: 'Reply Sent',
			description: 'Your reply was posted to the ticket.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Send Reply',
			description: extractServerMessage(error, 'Could not post your reply. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		sending.value = false;
	}
}

async function onPatch(body: TicketPatchInput) {
	try {
		await patchTicket(body);
		toast.add({
			title: 'Ticket Updated',
			description: 'Your changes were saved.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Update Ticket',
			description: extractServerMessage(error, 'Could not save your changes. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	}
}
</script>
