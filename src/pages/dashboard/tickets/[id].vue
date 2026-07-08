<template>
	<div class="mx-auto flex max-w-6xl flex-col gap-5">
		<div class="flex flex-wrap items-center gap-3">
			<UButton
				color="neutral"
				variant="ghost"
				icon="mdi:arrow-left"
				to="/dashboard/tickets"
				>Back</UButton
			>
			<div
				v-if="ticket"
				class="min-w-0 flex-1"
			>
				<div class="flex items-center gap-2">
					<h1 class="truncate text-xl font-semibold">{{ ticket.title }}</h1>
					<span class="font-mono text-sm text-slate-400">#{{ ticket.id }}</span>
				</div>
				<div class="mt-1 flex items-center gap-1.5">
					<TicketStatusBadge :status="ticket.status" />
					<TicketPriorityBadge :priority="ticket.priority" />
				</div>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
			<div class="flex min-w-0 flex-col gap-5">
				<div
					v-if="ticket?.description"
					class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
				>
					<p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Description</p>
					<p class="mt-1 whitespace-pre-wrap text-sm">{{ ticket.description }}</p>
				</div>

				<TicketThread
					:messages="messages"
					:pending="threadPending"
				/>

				<MessageComposer
					v-if="canReply"
					ref="composer"
					:sending="sending"
					:default-identity="defaultIdentity"
					@send="onSend"
				/>
			</div>

			<TicketSidebar
				v-if="ticket"
				:ticket="ticket"
				:customer="customer"
				:labels="labels"
				:users="users"
				@patch="onPatch"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { TicketAttachmentInput, TicketPatchInput } from '~/shared/types/ticket';
import type { Customer, User } from '~/shared/types/user';
import { Permission } from '~/shared/types/user';
import { useUserStore } from '~/stores/user';

definePageMeta({ layout: 'dashboard', middleware: 'staff' });

const toast = useToast();
const route = useRoute();
const { can, isAdmin } = useAuth();
const userStore = useUserStore();

const ticketId = computed(() => Number(route.params.id));

const { ticket, messages, fetchThread, patchTicket, reply } = useTicket(ticketId);
const { labels } = useLabels(() => ({}));
const { fetchCustomer } = useCustomers();

const threadPending = ref(true);
const sending = ref(false);
const composer = ref<{ reset: () => void } | null>(null);

const customer = ref<Customer | null>(null);
const users = ref<User[]>([]);

const canReply = computed(() => isAdmin.value || can(Permission.ReplyTicket));
const defaultIdentity = computed<'self' | 'team'>(() => 'team');

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
		}
	},
	{ immediate: true }
);

async function onSend(payload: {
	message: string;
	identity: 'self' | 'team';
	attachments: TicketAttachmentInput[];
}) {
	sending.value = true;
	try {
		await reply({
			message: payload.message,
			identity: payload.identity,
			attachments: payload.attachments
		});
		composer.value?.reset();
		toast.add({
			title: 'Reply Sent',
			description: 'Your reply was posted to the ticket.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch {
		toast.add({
			title: 'Failed to Send Reply',
			description: 'Could not post your reply. Please try again.',
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
	} catch {
		toast.add({
			title: 'Failed to Update Ticket',
			description: 'Could not save your changes. Please try again.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	}
}
</script>
