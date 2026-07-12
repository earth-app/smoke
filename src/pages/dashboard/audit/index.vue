<template>
	<div class="mx-auto flex max-w-6xl flex-col gap-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 class="text-2xl font-semibold">Audit Log</h1>
				<p class="text-sm text-slate-500">
					Review who changed what across tickets, users, labels, and settings.
				</p>
			</div>
			<div
				v-if="canView"
				class="flex items-center gap-2"
			>
				<UButton
					color="neutral"
					variant="soft"
					icon="mdi:file-delimited-outline"
					:loading="exporting === 'csv'"
					@click="onExport('csv')"
					>Export as CSV</UButton
				>
				<UButton
					color="neutral"
					variant="soft"
					icon="mdi:code-json"
					:loading="exporting === 'json'"
					@click="onExport('json')"
					>Export as JSON</UButton
				>
				<UButton
					color="neutral"
					variant="soft"
					icon="mdi:text-box-outline"
					:loading="exporting === 'txt'"
					@click="onExport('txt')"
					>Export as TXT</UButton
				>
			</div>
		</div>

		<div
			v-if="!canView"
			class="rounded-lg border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900"
		>
			<UIcon
				name="mdi:lock-outline"
				class="mx-auto size-8 text-slate-400"
			/>
			<p class="mt-2 text-sm font-medium">You Do Not Have Access</p>
			<p class="text-xs text-slate-500">
				Viewing the audit log requires the View Audit Log permission.
			</p>
		</div>

		<template v-else>
			<div class="flex flex-wrap items-end gap-3">
				<UInput
					v-model="search"
					icon="mdi:magnify"
					placeholder="Search Summaries, Actions, or Targets"
					class="min-w-56 flex-1"
				/>
				<USelect
					v-model="actionFilter"
					:items="actionItems"
					class="w-56"
				/>
				<USelect
					v-model="priorityFilter"
					:items="priorityItems"
					class="w-40"
				/>
				<UFormField
					label="From"
					size="xs"
				>
					<UInput
						v-model="fromDate"
						type="date"
						class="w-40"
					/>
				</UFormField>
				<UFormField
					label="To"
					size="xs"
				>
					<UInput
						v-model="toDate"
						type="date"
						class="w-40"
					/>
				</UFormField>
				<UButton
					v-if="hasFilters"
					color="neutral"
					variant="ghost"
					icon="mdi:filter-off-outline"
					@click="clearFilters"
					>Clear</UButton
				>
			</div>

			<div
				v-if="actorFilter || ticketFilter"
				class="flex flex-wrap items-center gap-2"
			>
				<UBadge
					v-if="actorFilter"
					color="primary"
					variant="subtle"
					trailing-icon="mdi:close"
					class="cursor-pointer"
					@click="
						() => {
							actorFilter = '';
							actorName = '';
						}
					"
					>Actor: {{ actorName || actorFilter }}</UBadge
				>
				<UBadge
					v-if="ticketFilter"
					color="primary"
					variant="subtle"
					trailing-icon="mdi:close"
					class="cursor-pointer"
					@click="ticketFilter = ''"
					>Ticket #{{ ticketFilter }}</UBadge
				>
			</div>

			<div
				class="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
			>
				<UTable
					:data="entries"
					:columns="columns"
					:loading="pending"
					:empty="pending ? 'Loading Entries...' : 'No Audit Entries Found'"
				>
					<template #created_at-cell="{ row }">
						<span class="whitespace-nowrap text-xs text-slate-500">{{
							formatTime(row.original.created_at)
						}}</span>
					</template>

					<template #action-cell="{ row }">
						<span class="font-mono text-xs">{{ prettyAction(row.original.action) }}</span>
					</template>

					<template #actor-cell="{ row }">
						<span class="text-sm">{{ actorLabel(row.original) }}</span>
					</template>

					<template #target-cell="{ row }">
						<NuxtLink
							v-if="row.original.ticket_id != null"
							:to="`/dashboard/tickets/${row.original.ticket_id}`"
							class="text-sm text-primary-600 hover:underline dark:text-primary-400"
							>Ticket #{{ row.original.ticket_id }}</NuxtLink
						>
						<span
							v-else-if="row.original.target_type"
							class="text-sm text-slate-600 dark:text-slate-300"
							>{{ targetLabel(row.original) }}</span
						>
						<span
							v-else
							class="text-sm text-slate-400"
							>-</span
						>
					</template>

					<template #priority-cell="{ row }">
						<UBadge
							:color="priorityColor(row.original.priority)"
							variant="subtle"
							size="sm"
							class="capitalize"
							>{{ row.original.priority || 'normal' }}</UBadge
						>
					</template>

					<template #details-cell="{ row }">
						<div class="flex items-center gap-2">
							<span class="text-sm text-slate-600 dark:text-slate-300">{{
								row.original.summary || '-'
							}}</span>
							<UPopover v-if="row.original.context">
								<UButton
									icon="mdi:information-outline"
									color="neutral"
									variant="ghost"
									size="xs"
								/>
								<template #content>
									<pre class="max-h-72 max-w-md overflow-auto p-3 text-xs">{{
										prettyContext(row.original.context)
									}}</pre>
								</template>
							</UPopover>
						</div>
					</template>

					<template #actions-cell="{ row }">
						<UDropdownMenu
							:items="rowMenu(row.original)"
							:content="{ align: 'end' }"
						>
							<UButton
								icon="mdi:dots-horizontal"
								color="neutral"
								variant="ghost"
								size="xs"
								aria-label="Row Actions"
							/>
						</UDropdownMenu>
					</template>
				</UTable>
			</div>

			<div
				v-if="total > limit"
				class="flex justify-center"
			>
				<UPagination
					v-model:page="page"
					:total="total"
					:items-per-page="limit"
				/>
			</div>
		</template>
	</div>
</template>

<script setup lang="ts">
import type { ContextMenuItem, TableColumn } from '@nuxt/ui';
import { Permission } from '~/shared/types/user';
import type { AuditEntry, AuditExportFormat, AuditQuery } from '~/stores/audit';

definePageMeta({ layout: 'dashboard', middleware: 'staff' });
useSeoMeta({ title: 'Audit Log' });

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { can, isAdmin } = useAuth();
const { auditMenu } = useEntityMenus();
const { entries, total, pending, fetchAudit, download } = useAudit();

const canView = computed(() => isAdmin.value || can(Permission.ViewAuditLog));

const limit = 25;

const search = ref((route.query.search as string) || '');
const actionFilter = ref((route.query.action as string) || 'all');
const priorityFilter = ref((route.query.priority as string) || 'all');
const fromDate = ref((route.query.from as string) || '');
const toDate = ref((route.query.to as string) || '');
// actor/ticket scope live in refs (not read straight off the url) so the url sync doesn't drop them
const actorFilter = ref((route.query.actor_id as string) || '');
const actorName = ref('');
const ticketFilter = ref(route.query.ticket_id != null ? String(route.query.ticket_id) : '');
const page = ref(Number(route.query.page) || 1);
const exporting = ref<AuditExportFormat | null>(null);

const KNOWN_ACTIONS = [
	'ticket.created',
	'ticket.updated',
	'ticket.deleted',
	'ticket.message_added',
	'ticket.message_edited',
	'ticket.message_deleted',
	'ticket.participant_added',
	'ticket.participant_removed',
	'customer.created',
	'customer.updated',
	'customer.deleted',
	'customer.magic_link_issued',
	'user.created',
	'user.updated',
	'user.deleted',
	'user.password_changed',
	'label.created',
	'label.updated',
	'label.deleted',
	'settings.updated',
	'auth.login',
	'auth.logout',
	'auth.magic_link_issued',
	'auth.invite_issued',
	'auth.invite_consumed',
	'auth.password_reset_requested'
];

function prettyAction(action: string): string {
	return action
		.split(/[._]/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

const actionItems = computed(() => [
	{ label: 'All Actions', value: 'all' },
	...KNOWN_ACTIONS.map((action) => ({ label: prettyAction(action), value: action }))
]);

const priorityItems = [
	{ label: 'All Priorities', value: 'all' },
	{ label: 'Low', value: 'low' },
	{ label: 'Normal', value: 'normal' },
	{ label: 'High', value: 'high' },
	{ label: 'Critical', value: 'critical' }
];

const columns: TableColumn<AuditEntry>[] = [
	{ accessorKey: 'created_at', header: 'Time' },
	{ accessorKey: 'action', header: 'Action' },
	{ id: 'actor', header: 'Actor' },
	{ id: 'target', header: 'Target' },
	{ accessorKey: 'priority', header: 'Priority' },
	{ id: 'details', header: 'Details' },
	{ id: 'actions', header: '' }
];

function filterByAction(entry: AuditEntry) {
	actionFilter.value = entry.action;
}
function filterByActor(entry: AuditEntry) {
	actorFilter.value = entry.actor_id || '';
	actorName.value = entry.actor_name || entry.actor_id || '';
}
function filterByTicket(entry: AuditEntry) {
	ticketFilter.value = entry.ticket_id != null ? String(entry.ticket_id) : '';
}

const rowMenu = (entry: AuditEntry) =>
	auditMenu(entry, {
		onFilterAction: filterByAction,
		onFilterActor: filterByActor,
		onFilterTicket: filterByTicket
	});

// 'YYYY-MM-DD' parses as utc midnight; 'to' is pushed to the end of the day so the range is inclusive
const fromSeconds = computed(() => {
	if (!fromDate.value) return undefined;
	const ms = Date.parse(fromDate.value);
	return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
});
const toSeconds = computed(() => {
	if (!toDate.value) return undefined;
	const ms = Date.parse(toDate.value);
	return Number.isFinite(ms) ? Math.floor(ms / 1000) + 86_399 : undefined;
});

const activeQuery = computed<AuditQuery>(() => {
	const q: AuditQuery = { page: page.value, limit, sort: 'created_at', sort_direction: 'desc' };
	if (search.value.trim()) q.search = search.value.trim();
	if (actionFilter.value !== 'all') q.action = actionFilter.value;
	if (priorityFilter.value !== 'all') q.priority = priorityFilter.value;
	if (fromSeconds.value != null) q.from = fromSeconds.value;
	if (toSeconds.value != null) q.to = toSeconds.value;
	if (actorFilter.value) q.actor_id = actorFilter.value;
	if (ticketFilter.value) q.ticket_id = Number(ticketFilter.value);
	return q;
});

const hasFilters = computed(
	() =>
		!!search.value.trim() ||
		actionFilter.value !== 'all' ||
		priorityFilter.value !== 'all' ||
		!!fromDate.value ||
		!!toDate.value ||
		!!actorFilter.value ||
		!!ticketFilter.value
);

function actorLabel(row: AuditEntry): string {
	return row.actor_name || row.actor_id || 'System';
}

function targetLabel(row: AuditEntry): string {
	if (!row.target_type) return '-';
	const type = row.target_type.charAt(0).toUpperCase() + row.target_type.slice(1);
	return row.target_id ? `${type} ${row.target_id}` : type;
}

function priorityColor(priority: string | null): 'neutral' | 'info' | 'warning' | 'error' {
	if (priority === 'critical') return 'error';
	if (priority === 'high') return 'warning';
	if (priority === 'low') return 'neutral';
	return 'info';
}

function formatTime(seconds: number): string {
	return new Date(Number(seconds) * 1000).toLocaleString();
}

function prettyContext(context: Record<string, unknown> | null): string {
	if (!context) return '';
	try {
		return JSON.stringify(context, null, 2);
	} catch {
		return String(context);
	}
}

// reset to the first page whenever a filter (not the page itself) changes
watch([search, actionFilter, priorityFilter, fromDate, toDate, actorFilter, ticketFilter], () => {
	page.value = 1;
});

// keep filters + page in the url so a view is shareable
watch(
	activeQuery,
	() => {
		if (!canView.value) return;
		const q: Record<string, string> = {};
		if (search.value.trim()) q.search = search.value.trim();
		if (actionFilter.value !== 'all') q.action = actionFilter.value;
		if (priorityFilter.value !== 'all') q.priority = priorityFilter.value;
		if (fromDate.value) q.from = fromDate.value;
		if (toDate.value) q.to = toDate.value;
		if (actorFilter.value) q.actor_id = actorFilter.value;
		if (ticketFilter.value) q.ticket_id = ticketFilter.value;
		if (page.value > 1) q.page = String(page.value);
		router.replace({ query: q });
		fetchAudit(activeQuery.value);
	},
	{ immediate: true }
);

async function onExport(format: AuditExportFormat) {
	exporting.value = format;
	try {
		await download(activeQuery.value, format);
	} catch (error) {
		toast.add({
			title: 'Export Failed',
			description: extractServerMessage(error, 'Could not export the audit log. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		exporting.value = null;
	}
}

function clearFilters() {
	search.value = '';
	actionFilter.value = 'all';
	priorityFilter.value = 'all';
	fromDate.value = '';
	toDate.value = '';
	actorFilter.value = '';
	actorName.value = '';
	ticketFilter.value = '';
	page.value = 1;
}

// page context menu: export, refresh, clear (only once the viewer is authorized)
setPageMenu(() => {
	if (!canView.value) return [];
	const exportSection: ContextMenuItem[] = [
		{ label: 'Export as CSV', icon: 'mdi:file-delimited-outline', onSelect: () => onExport('csv') },
		{ label: 'Export as JSON', icon: 'mdi:code-json', onSelect: () => onExport('json') },
		{ label: 'Export as TXT', icon: 'mdi:text-box-outline', onSelect: () => onExport('txt') }
	];
	const view: ContextMenuItem[] = [
		{ label: 'Refresh', icon: 'mdi:refresh', onSelect: () => fetchAudit(activeQuery.value) }
	];
	if (hasFilters.value)
		view.push({ label: 'Clear Filters', icon: 'mdi:filter-off-outline', onSelect: clearFilters });
	return [exportSection, view];
});
</script>
