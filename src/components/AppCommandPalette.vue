<template>
	<UModal
		v-model:open="open"
		:ui="{ content: 'sm:max-w-2xl' }"
	>
		<template #content>
			<div class="flex items-center gap-2 border-b border-default px-4 py-2 text-xs text-muted">
				<UIcon
					:name="roleIcon"
					class="size-4 shrink-0"
				/>
				<span>Signed in as {{ roleLabel }}</span>
			</div>
			<UCommandPalette
				v-model:search-term="search"
				:groups="allGroups"
				placeholder="Search or jump to..."
				close
				@update:model-value="hide"
				@update:open="open = $event"
			>
				<template #empty>
					<div class="p-4 text-center text-sm text-muted">
						<template v-if="search">No matches for "{{ search }}".</template>
						<template v-else>Type to search or jump anywhere.</template>
					</div>
				</template>
			</UCommandPalette>
		</template>
	</UModal>
</template>

<script setup lang="ts">
import type { CommandGroup } from '~/composables/useCommands';

type SearchGroup = CommandGroup & { ignoreFilter?: boolean };

const { open, toggle, show, hide } = useCommandPalette();
const { groups, shortcuts, roleLabel, roleIcon } = useCommands();
const auth = useAuth();
const route = useRoute();

const search = ref('');

// close on navigation; clear the box each time it closes so it reopens fresh
watch(
	() => route.fullPath,
	() => hide()
);
watch(open, (isOpen) => {
	if (!isOpen) search.value = '';
});

// meta_k/ctrl_k open even while an input is focused (usingInput:true); nav chords + `/` stay
// input-gated by default so typing never triggers them. the computed keeps it in sync with identity
const shortcutConfig = computed(() => ({
	meta_k: { handler: () => toggle(), usingInput: true },
	ctrl_k: { handler: () => toggle(), usingInput: true },
	'/': () => show(),
	...shortcuts.value
}));
defineShortcuts(shortcutConfig);

// lazy staff datasets for dynamic search; only fetched client-side once, when a signed-in staffer
// first opens the palette (guests never trigger the authed list calls)
const { tickets, listTickets } = useTickets();
const { customers, listCustomers } = useCustomers();

const searchLoaded = ref(false);
watch(open, (isOpen) => {
	if (!isOpen || !auth.isAuthenticated.value || searchLoaded.value) return;
	searchLoaded.value = true;
	listTickets({ limit: 50, sort: 'updated_at', sort_direction: 'desc' });
	listCustomers({ limit: 100 });
});

// dynamic result groups are pre-filtered here, so ignoreFilter tells fuse to leave them alone
const dynamicGroups = computed<SearchGroup[]>(() => {
	const q = search.value.trim().toLowerCase();
	if (!q || !auth.isAuthenticated.value) return [];

	const out: SearchGroup[] = [];

	const ticketItems = tickets.value
		.filter((t) => t.title.toLowerCase().includes(q) || String(t.id).includes(q))
		.slice(0, 6)
		.map((t) => ({
			id: `ticket-${t.id}`,
			label: `#${t.id} ${t.title}`,
			icon: 'mdi:ticket-outline',
			to: `/dashboard/tickets/${t.id}`,
			suffix: t.status
		}));
	if (ticketItems.length)
		out.push({ id: 'search-tickets', label: 'Tickets', items: ticketItems, ignoreFilter: true });

	const customerItems = customers.value
		.filter((c) => (c.name || '').toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
		.slice(0, 6)
		.map((c) => ({
			id: `customer-${c.id}`,
			label: c.name || c.email,
			icon: 'mdi:account-outline',
			to: `/dashboard/customers/${c.id}`,
			suffix: c.name ? c.email : undefined
		}));
	if (customerItems.length)
		out.push({
			id: 'search-customers',
			label: 'Customers',
			items: customerItems,
			ignoreFilter: true
		});

	return out;
});

const allGroups = computed<SearchGroup[]>(() => [...groups.value, ...dynamicGroups.value]);
</script>
