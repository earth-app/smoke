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
			class="space-y-6"
		>
			<UCard>
				<div class="flex flex-col gap-3">
					<div class="flex items-start justify-between gap-4">
						<div>
							<p class="text-sm text-muted">Ticket #{{ ticket.id }}</p>
							<h2 class="text-xl font-semibold">{{ ticket.title }}</h2>
						</div>
						<UBadge
							:color="statusColor"
							variant="subtle"
							class="shrink-0 capitalize"
						>
							{{ formatEnum(ticket.status) }}
						</UBadge>
					</div>
					<div class="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
						<span>
							Priority:
							<span class="font-medium capitalize text-highlighted">{{
								formatEnum(ticket.priority)
							}}</span>
						</span>
						<span>Opened {{ formatDate(ticket.created_at) }}</span>
					</div>
				</div>
			</UCard>

			<div>
				<h3 class="mb-3 text-lg font-semibold">Conversation</h3>
				<div
					v-if="ticket.messages.length"
					class="space-y-3"
				>
					<UCard
						v-for="(message, index) in ticket.messages"
						:key="index"
						:class="message.sender_kind === 'customer' ? 'sm:ml-8' : 'sm:mr-8'"
					>
						<div class="flex items-center justify-between gap-2 text-sm">
							<span class="flex items-center gap-2 font-medium">
								<UIcon
									:name="
										message.sender_kind === 'customer' ? 'mdi:account-outline' : 'mdi:face-agent'
									"
									class="size-4 text-primary"
								/>
								{{ message.sender_kind === 'customer' ? 'You' : 'Support' }}
							</span>
							<span class="text-muted">{{ formatDate(message.created_at) }}</span>
						</div>
						<p class="mt-2 whitespace-pre-wrap text-sm text-default">{{ message.message }}</p>
					</UCard>
				</div>
				<UCard v-else>
					<p class="py-4 text-center text-sm text-muted">
						No updates yet. We'll email you when there's news.
					</p>
				</UCard>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' });

type StatusMessage = { message: string; sender_kind: string; created_at: string | number | Date };
type StatusTicket = {
	id: number;
	title: string;
	status: string;
	priority: string;
	created_at: string | number | Date;
	updated_at: string | number | Date;
	messages: StatusMessage[];
};

const route = useRoute();
const token = computed(() => String(route.params.token || ''));
const id = computed(() => {
	const raw = route.query.id;
	return Array.isArray(raw) ? raw[0] : raw;
});

const { data, pending, error } = await useAsyncData(
	() => `public-status:${id.value}:${token.value}`,
	() =>
		$fetch<StatusTicket>('/api/public/status', {
			query: { id: id.value, token: token.value }
		}),
	{ watch: [id, token] }
);

const ticket = computed(() => data.value);

const statusColor = computed(() => {
	switch (ticket.value?.status) {
		case 'closed':
		case 'wont_fix':
			return 'neutral';
		case 'work_in_progress':
		case 'open':
			return 'info';
		case 'pending':
			return 'warning';
		default:
			return 'primary';
	}
});

function formatEnum(value: string): string {
	return value.replace(/_/g, ' ');
}

function formatDate(value: string | number | Date): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
}

useSeoMeta({ title: 'Request Status' });
</script>
