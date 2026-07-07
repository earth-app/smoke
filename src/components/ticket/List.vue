<template>
	<div
		class="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
	>
		<div
			v-if="pending"
			class="divide-y divide-slate-100 dark:divide-slate-800"
		>
			<div
				v-for="n in 6"
				:key="n"
				class="flex items-center gap-3 px-4 py-3"
			>
				<USkeleton class="size-4 rounded" />
				<div class="flex-1 space-y-2">
					<USkeleton class="h-4 w-1/3" />
					<USkeleton class="h-3 w-2/3" />
				</div>
				<USkeleton class="h-5 w-16 rounded-full" />
			</div>
		</div>

		<div
			v-else-if="!tickets.length"
			class="flex flex-col items-center gap-2 px-4 py-16 text-center"
		>
			<UIcon
				name="mdi:ticket-outline"
				class="size-10 text-slate-300"
			/>
			<p class="text-sm font-medium">No Tickets Found</p>
			<p class="text-sm text-slate-500">
				Adjust your filters or create a new ticket to get started.
			</p>
		</div>

		<div
			v-else
			class="divide-y divide-slate-100 dark:divide-slate-800"
		>
			<TicketRow
				v-for="ticket in tickets"
				:key="ticket.id"
				:ticket="ticket"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { Ticket } from '~/shared/types/ticket';

withDefaults(defineProps<{ tickets: Ticket[]; pending?: boolean }>(), {
	pending: false
});
</script>
