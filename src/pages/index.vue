<template>
	<div class="relative overflow-hidden">
		<div
			class="pointer-events-none absolute inset-0 -z-10 bg-linear-to-b from-primary-50 to-white dark:from-slate-900 dark:to-slate-950"
		/>

		<section
			class="mx-auto flex w-full max-w-5xl flex-col items-center px-4 py-16 text-center sm:px-8 sm:py-24"
		>
			<UIcon
				name="mdi:lifebuoy"
				class="size-14 text-primary"
			/>
			<h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{ siteName }}</h1>
			<p class="mt-4 max-w-2xl text-lg text-muted sm:text-xl">{{ siteDescription }}</p>

			<div class="mt-10 flex flex-col flex-wrap justify-center gap-3 sm:flex-row">
				<template v-if="authResolving">
					<Skeleton
						variant="rect"
						width="12rem"
						height="3rem"
						rounded="rounded-lg"
					/>
					<Skeleton
						variant="rect"
						width="10rem"
						height="3rem"
						rounded="rounded-lg"
					/>
				</template>
				<template v-else-if="isStaff">
					<UButton
						to="/dashboard"
						size="xl"
						color="primary"
						icon="mdi:view-dashboard-outline"
						>Go to Dashboard</UButton
					>
					<UButton
						to="/dashboard/tickets"
						size="xl"
						color="neutral"
						variant="subtle"
						icon="mdi:ticket-outline"
						>View Tickets</UButton
					>
				</template>
				<template v-else>
					<UButton
						to="/submit"
						size="xl"
						color="primary"
						icon="mdi:ticket-outline"
						>Submit a Request</UButton
					>
					<UButton
						to="/search"
						size="xl"
						color="neutral"
						variant="subtle"
						icon="mdi:magnify"
						>Browse Requests</UButton
					>
					<UButton
						to="/portal/login"
						size="xl"
						color="neutral"
						variant="ghost"
						icon="mdi:account-circle-outline"
						>My Requests</UButton
					>
				</template>
			</div>
		</section>

		<template v-if="authResolving">
			<section
				class="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-8 sm:grid-cols-2 sm:px-8 lg:grid-cols-4"
			>
				<Skeleton
					v-for="i in 4"
					:key="`ql-${i}`"
					variant="rect"
					height="2.75rem"
					rounded="rounded-lg"
				/>
			</section>

			<section
				class="mx-auto grid w-full max-w-5xl grid-cols-2 gap-4 px-4 pb-8 sm:px-8 lg:grid-cols-4"
			>
				<Skeleton
					v-for="i in 4"
					:key="`stat-${i}`"
					variant="rect"
					height="5.5rem"
					rounded="rounded-lg"
				/>
			</section>

			<section class="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-24 sm:px-8 lg:grid-cols-2">
				<Skeleton
					variant="rect"
					height="16rem"
					rounded="rounded-lg"
				/>
				<Skeleton
					variant="rect"
					height="16rem"
					rounded="rounded-lg"
				/>
			</section>
		</template>

		<template v-else-if="isStaff">
			<section
				class="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-8 sm:grid-cols-2 sm:px-8 lg:grid-cols-4"
			>
				<UButton
					v-for="link in staffLinks"
					:key="link.to"
					:to="link.to"
					color="neutral"
					variant="soft"
					size="lg"
					:icon="link.icon"
					block
					>{{ link.label }}</UButton
				>
			</section>

			<section
				v-if="canViewAnalytics"
				class="mx-auto w-full max-w-5xl px-4 pb-8 sm:px-8"
			>
				<AppSummaryStats />
			</section>

			<section class="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-24 sm:px-8 lg:grid-cols-2">
				<AppRecentTickets />
				<AppRecentCustomers v-if="canViewAnalytics" />
				<AppSettingsPreview v-if="canManageSettings" />
			</section>
		</template>

		<template v-else>
			<section class="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-12 sm:grid-cols-3 sm:px-8">
				<UCard
					v-for="feature in features"
					:key="feature.title"
				>
					<div class="flex flex-col items-start gap-3">
						<UIcon
							:name="feature.icon"
							class="size-8 text-primary"
						/>
						<h2 class="text-lg font-semibold">{{ feature.title }}</h2>
						<p class="text-sm text-muted">{{ feature.body }}</p>
					</div>
				</UCard>
			</section>

			<section
				v-if="myRequests.length"
				class="mx-auto w-full max-w-2xl px-4 pb-12 sm:px-8"
			>
				<TicketMyRequests />
			</section>

			<section class="mx-auto w-full max-w-2xl px-4 pb-24 sm:px-8">
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-lg font-semibold">Public Requests</h2>
					<UButton
						to="/search"
						variant="link"
						color="primary"
						icon="mdi:magnify"
						size="sm"
						>Search All</UButton
					>
				</div>
				<div
					v-if="publicTickets.length"
					class="space-y-2"
				>
					<UCard
						v-for="t in publicTickets"
						:key="t.id"
					>
						<NuxtLink
							:to="`/status/${encodeURIComponent(t.token)}?id=${t.id}`"
							class="flex items-center justify-between gap-3 hover:opacity-80"
						>
							<span class="min-w-0 flex-1 truncate text-sm font-medium">{{ t.title }}</span>
							<UBadge
								color="neutral"
								variant="subtle"
								class="shrink-0 capitalize"
								>{{ formatStatus(t.status) }}</UBadge
							>
						</NuxtLink>
					</UCard>
				</div>
				<UCard v-else>
					<div class="flex flex-col items-center gap-3 py-6 text-center">
						<UIcon
							name="mdi:inbox-outline"
							class="size-10 text-muted"
						/>
						<p class="text-sm text-muted">
							No public requests to browse yet. Be the first to open one.
						</p>
						<UButton
							to="/submit"
							color="primary"
							variant="soft"
							icon="mdi:ticket-outline"
							size="sm"
							>Submit a Request</UButton
						>
					</div>
				</UCard>
			</section>
		</template>
	</div>
</template>

<script setup lang="ts">
import { Permission } from '~/shared/types/user';

definePageMeta({ layout: 'default' });

const { settings } = useSettings();
const { user, sessionToken, isAuthenticated, can, isAdmin } = useAuth();
const { requests: myRequests } = useMyRequests();

// triple-state: undefined = loading, or a session cookie is present but the user hasn't resolved yet;
// leaning to the staff skeleton avoids flashing the anonymous view before auth hydrates
const authResolving = computed(
	() => user.value === undefined || (!!sessionToken.value && !user.value)
);
const isStaff = computed(() => isAuthenticated.value);

const canViewAnalytics = computed(() => isAdmin.value || can(Permission.ManageTicket));
const canManageSettings = computed(() => isAdmin.value || can(Permission.ManageSettings));

const siteName = computed(() => (settings.value?.name as string) || 'Smoke');
const siteDescription = computed(
	() =>
		(settings.value?.description as string) ||
		'Get help fast. Submit a request and track its status from anywhere.'
);

const staffLinks = computed(() => {
	const links = [
		{ to: '/dashboard/tickets', label: 'Tickets', icon: 'mdi:ticket-outline' },
		{ to: '/dashboard/customers', label: 'Customers', icon: 'mdi:account-group-outline' },
		{ to: '/dashboard', label: 'Analytics', icon: 'mdi:chart-box-outline' }
	];
	if (canManageSettings.value) {
		links.push({ to: '/dashboard/settings', label: 'Settings', icon: 'mdi:cog-outline' });
	}
	return links;
});

const features = [
	{
		icon: 'mdi:send-outline',
		title: 'Submit in Seconds',
		body: 'Send us a request with just your email and a short description.'
	},
	{
		icon: 'mdi:radar',
		title: 'Track Anytime',
		body: 'Use your status link or verify your email to follow every update.'
	},
	{
		icon: 'mdi:email-fast-outline',
		title: 'Replies by Email',
		body: 'Our team responds straight to your inbox; just reply to continue.'
	}
];

type PublicTicket = {
	id: number;
	title: string;
	status: string;
	created_at: string;
	token: string;
};

// anonymous browse of recent public tickets (customers also see their own via TicketMyRequests)
const { data: browseData } = await useAsyncData(
	'public-tickets-browse',
	() => $fetch<{ results: PublicTicket[] }>('/api/public/search', { query: { limit: 8 } }),
	{ default: () => ({ results: [] as PublicTicket[] }) }
);
const publicTickets = computed(() => browseData.value?.results || []);

function formatStatus(value: string): string {
	return value.replace(/_/g, ' ');
}

useSeoMeta({
	title: () => siteName.value,
	description: () => siteDescription.value,
	ogTitle: () => siteName.value,
	ogDescription: () => siteDescription.value,
	ogImage: '/favicon.png',
	twitterCard: 'summary'
});
useSchemaOrg([defineWebPage({ '@type': ['WebPage', 'CollectionPage'] })]);
</script>
