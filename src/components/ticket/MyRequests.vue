<template>
	<div v-if="requests.length">
		<h3 class="mb-3 text-lg font-semibold">My Requests</h3>
		<div class="space-y-2">
			<UCard
				v-for="entry in requests"
				:key="entry.id"
			>
				<div class="flex items-center justify-between gap-3">
					<NuxtLink
						:to="linkFor(entry)"
						class="flex min-w-0 flex-1 items-center gap-3"
					>
						<UIcon
							name="mdi:ticket-outline"
							class="size-5 shrink-0 text-primary"
						/>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-highlighted">{{ entry.title }}</p>
							<p class="text-xs text-muted">
								Ticket #{{ entry.id }} - {{ formatDate(entry.created_at) }}
							</p>
						</div>
					</NuxtLink>
					<UButton
						color="neutral"
						variant="ghost"
						icon="mdi:close"
						size="xs"
						aria-label="Remove"
						@click="forget(entry.id)"
					/>
				</div>
			</UCard>
		</div>
	</div>
</template>

<script setup lang="ts">
const { requests, forget, linkFor } = useMyRequests();

function formatDate(value: number): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}
</script>
