<template>
	<div class="mx-auto w-full max-w-2xl px-4 py-12 sm:px-8">
		<div class="mb-8 text-center">
			<UIcon
				name="mdi:radar"
				class="mx-auto size-12 text-primary"
			/>
			<h1 class="mt-3 text-3xl font-bold">Request Status</h1>
			<p class="mt-2 text-muted">Follow the progress of your support request.</p>
		</div>

		<div
			v-if="pending"
			class="flex justify-center py-16"
		>
			<UIcon
				name="mdi:loading"
				class="size-8 animate-spin text-muted"
			/>
		</div>

		<UCard v-else-if="error || !ticket">
			<div class="flex flex-col items-center gap-4 py-6 text-center">
				<UIcon
					name="mdi:file-search-outline"
					class="size-12 text-muted"
				/>
				<h2 class="text-xl font-semibold">Request Not Found</h2>
				<p class="max-w-sm text-muted">
					We couldn't find a request for this link. Double-check the URL from your confirmation
					email, or submit a new request.
				</p>
				<UButton
					to="/submit"
					color="primary"
					icon="mdi:ticket-outline"
				>
					Submit a Request
				</UButton>
			</div>
		</UCard>

		<div
			v-else
			class="space-y-5"
		>
			<UAlert
				v-if="isAuthenticated"
				color="info"
				variant="subtle"
				icon="mdi:shield-account-outline"
				title="Staff View"
				description="You are viewing the public status page for this request."
				orientation="horizontal"
			>
				<template #actions>
					<UButton
						:to="`/dashboard/tickets/${ticket.id}`"
						color="info"
						variant="solid"
						size="sm"
						icon="mdi:open-in-new"
					>
						Open in Dashboard
					</UButton>
				</template>
			</UAlert>

			<TicketDeletionBanner
				v-if="bannerTicket"
				:ticket="bannerTicket"
			/>

			<TicketConversation
				:header="ticket"
				:messages="ticket.messages"
				:events="ticket.events"
				:locked="ticket.locked"
				:archived="ticket.archived"
				:can-reply="canReply"
			>
				<template #reply>
					<UCard>
						<h3 class="mb-3 text-lg font-semibold">Add a Reply</h3>
						<UTextarea
							v-model="reply"
							:rows="4"
							:disabled="sending"
							placeholder="Add more detail or reply to our team"
							class="w-full"
						/>
						<div class="mt-3 flex items-center justify-end gap-3">
							<TurnstileWidget
								v-if="turnstileActive"
								ref="turnstileRef"
								@received-token="turnstileToken = $event"
							/>
							<UButton
								color="primary"
								icon="mdi:send"
								:loading="sending"
								:disabled="!reply.trim() || (turnstileActive && !turnstileToken)"
								@click="sendReply"
							>
								Send Reply
							</UButton>
						</div>
					</UCard>
				</template>

				<template #actions>
					<TicketReopen
						v-if="canReopen"
						:ticket-id="ticket.id"
						:token="token"
						:turnstile="turnstileActive ? turnstileToken : undefined"
						@reopened="refresh"
					/>
				</template>
			</TicketConversation>
		</div>
	</div>
</template>

<script setup lang="ts">
import type {
	Ticket,
	TicketEvent,
	TicketMessage,
	TicketPriority,
	TicketStatus,
	TicketVisibility
} from '~/shared/types/ticket';

definePageMeta({ layout: 'default' });

type StatusTicket = {
	id: number;
	title: string;
	description: string;
	status: TicketStatus;
	priority: TicketPriority;
	visibility: TicketVisibility;
	color: string | null;
	icon: string | null;
	created_at: string | number | Date;
	updated_at: string | number | Date;
	locked?: boolean;
	archived?: boolean;
	archived_at?: string | number | Date | null;
	creator: { name?: string; email?: string } | null;
	can_reopen?: boolean;
	can_reply?: boolean;
	messages: TicketMessage[];
	events?: TicketEvent[];
};

const route = useRoute();
const { isAuthenticated } = useAuth();
const token = computed(() => String(route.params.token || ''));
const id = computed(() => {
	const raw = route.query.id;
	return Array.isArray(raw) ? raw[0] : raw;
});

const toast = useToast();
const { remember } = useMyRequests();

const config = useRuntimeConfig();
const turnstileActive = computed(() => !!config.public.turnstile?.siteKey);
const turnstileToken = ref('');
const turnstileRef = ref<{ reset: () => void } | null>(null);

const { data, pending, error, refresh } = await useAsyncData(
	() => `public-status:${id.value}:${token.value}`,
	() =>
		$fetch<StatusTicket>('/api/public/status', {
			query: { id: id.value, token: token.value }
		}),
	{ watch: [id, token] }
);

const ticket = computed(() => data.value);

const reply = ref('');
const sending = ref(false);

// remember any ticket opened via its link (incl. email-created ones) so it shows in My Requests
watch(
	ticket,
	(value) => {
		if (value)
			remember({ id: value.id, token: token.value, title: value.title, created_at: Date.now() });
	},
	{ immediate: true }
);

async function sendReply() {
	const message = reply.value.trim();
	if (!message) return;
	sending.value = true;
	try {
		await $fetch('/api/public/reply', {
			method: 'POST',
			body: {
				id: id.value,
				token: token.value,
				message,
				...(turnstileActive.value ? { turnstile: turnstileToken.value } : {})
			}
		});
		reply.value = '';
		turnstileToken.value = '';
		turnstileRef.value?.reset();
		await refresh();
		toast.add({
			title: 'Reply Sent',
			description: 'Your reply was added to the request.',
			icon: 'mdi:check-circle',
			color: 'success',
			duration: 3000
		});
	} catch (e) {
		toast.add({
			title: 'Failed to Send Reply',
			description: extractServerMessage(e, 'Please try again in a moment.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		sending.value = false;
	}
}

// token holders may reply unless the thread is locked or archived (archived is read-only)
const canReply = computed(() => {
	const t = ticket.value;
	if (!t) return false;
	return t.can_reply !== false && t.locked !== true && t.archived !== true;
});

// the staff deletion banner reads archived + archived_at off a Ticket-shaped object
const bannerTicket = computed<Ticket | null>(() =>
	ticket.value ? (ticket.value as unknown as Ticket) : null
);

// a closed or archived request can be reopened from this page when the owner allows it
const canReopen = computed(() => {
	const t = ticket.value;
	if (!t?.can_reopen) return false;
	return t.archived === true || t.status === 'closed' || t.status === 'wont_fix';
});

useSeoMeta({ title: 'Request Status', robots: 'noindex, nofollow' });
</script>
