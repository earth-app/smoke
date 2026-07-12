<template>
	<div class="mx-auto w-full max-w-3xl px-4 py-12 sm:px-8">
		<div
			v-if="resolving"
			class="space-y-6"
		>
			<div class="flex items-center justify-between gap-4">
				<div class="space-y-2">
					<Skeleton
						variant="line"
						width="12rem"
						height="1.75rem"
					/>
					<Skeleton
						variant="line"
						width="16rem"
						height="1rem"
					/>
				</div>
				<Skeleton
					variant="rect"
					width="6rem"
					height="2.25rem"
					rounded="rounded-md"
				/>
			</div>
			<Skeleton
				variant="rect"
				:repeat="4"
				height="4.5rem"
				rounded="rounded-lg"
			/>
		</div>

		<AppPortalStaffNotice v-else-if="isStaff" />

		<template v-else-if="customer">
			<div class="mb-8 flex items-start justify-between gap-4">
				<div>
					<h1 class="text-3xl font-bold">My Requests</h1>
					<p class="mt-2 text-muted">
						<template v-if="customer.email">
							Signed in as
							<span class="font-medium text-highlighted">{{ customer.email }}</span>
						</template>
						<template v-else>Manage all of your support requests in one place.</template>
					</p>
				</div>
				<UButton
					color="neutral"
					variant="soft"
					icon="mdi:logout-variant"
					:loading="loggingOut"
					@click="onLogout"
				>
					Log Out
				</UButton>
			</div>

			<Skeleton
				v-if="ticketsLoading"
				variant="rect"
				:repeat="4"
				height="4.5rem"
				rounded="rounded-lg"
			/>

			<div
				v-else-if="tickets.length"
				class="space-y-3"
			>
				<UContextMenu
					v-for="ticket in tickets"
					:key="ticket.id"
					:items="portalTicketMenu({ id: ticket.id, token: ticket.token })"
				>
					<UCard class="transition hover:ring-2 hover:ring-primary">
						<NuxtLink
							:to="`/status/${ticket.token}?id=${ticket.id}`"
							class="flex items-center justify-between gap-4"
						>
							<div class="min-w-0">
								<p class="text-sm text-muted">Ticket #{{ ticket.id }}</p>
								<h2 class="truncate text-lg font-semibold">{{ ticket.title }}</h2>
								<p class="mt-1 text-xs text-muted">Updated {{ formatDate(ticket.updated_at) }}</p>
							</div>
							<div class="flex shrink-0 items-center gap-2">
								<UIcon
									v-if="ticket.locked"
									name="mdi:lock"
									class="size-4 text-muted"
								/>
								<UBadge
									:color="statusColor(ticket.status)"
									variant="subtle"
									class="capitalize"
								>
									{{ formatEnum(ticket.status) }}
								</UBadge>
								<UIcon
									name="mdi:chevron-right"
									class="size-5 text-muted"
								/>
							</div>
						</NuxtLink>
					</UCard>
				</UContextMenu>
			</div>

			<UCard v-else>
				<div class="flex flex-col items-center gap-4 py-8 text-center">
					<UIcon
						name="mdi:inbox-outline"
						class="size-12 text-muted"
					/>
					<h2 class="text-xl font-semibold">No Requests Yet</h2>
					<p class="max-w-sm text-muted">
						When you submit a request or email our team, it will show up here.
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
		</template>
	</div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' });

type PortalTicket = {
	id: number;
	title: string;
	status: string;
	priority: string;
	created_at: string | number | Date;
	updated_at: string | number | Date;
	locked: boolean;
	archived: boolean;
	token: string;
};

const toast = useToast();
const { customer, logout } = useCustomerAuth();
const { user, sessionToken, isAuthenticated } = useAuth();
const { portalTicketMenu } = useEntityMenus();

// customer is undefined while /api/portal/me is in flight; auth cookie resolves the staff case
const authResolving = computed(
	() => user.value === undefined || (!!sessionToken.value && !user.value)
);
const isStaff = computed(() => isAuthenticated.value);
const resolving = computed(() => authResolving.value || customer.value === undefined);

const tickets = ref<PortalTicket[]>([]);
const ticketsLoading = ref(true);
const loggingOut = ref(false);

async function load() {
	ticketsLoading.value = true;
	try {
		const response = await $fetch<{ tickets: PortalTicket[] }>('/api/portal/tickets', {
			cache: 'no-store',
			credentials: 'include'
		});
		tickets.value = response.tickets;
	} catch (error: any) {
		const status = error?.statusCode || error?.response?.status || error?.status;
		if (status === 401) {
			await navigateTo('/portal/login');
			return;
		}
		toast.add({
			title: 'Could Not Load Requests',
			description: extractServerMessage(error, 'Please try again in a moment.'),
			icon: 'mdi:alert-circle',
			color: 'error'
		});
	} finally {
		ticketsLoading.value = false;
	}
}

async function onLogout() {
	loggingOut.value = true;
	try {
		await logout();
		await navigateTo('/portal/login');
	} finally {
		loggingOut.value = false;
	}
}

// load requests once a customer session resolves; anonymous non-customers go to the login
watch(
	[resolving, isStaff, customer],
	([isResolving, staff, current]) => {
		if (isResolving) return;
		if (staff) return;
		if (current) {
			load();
		} else {
			navigateTo('/portal/login');
		}
	},
	{ immediate: true }
);

function statusColor(status: string) {
	switch (status) {
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
}

function formatEnum(value: string): string {
	return value.replace(/_/g, ' ');
}

function formatDate(value: string | number | Date): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

useSeoMeta({ title: 'My Requests', robots: 'noindex, nofollow' });
</script>
