<template>
	<div class="flex flex-col gap-5">
		<UInput
			v-model="q"
			icon="mdi:magnify"
			size="lg"
			:placeholder="archived ? 'Search archived requests' : 'Search public requests'"
			class="w-full"
		/>

		<div
			v-if="pending"
			class="flex justify-center py-10"
		>
			<UIcon
				name="mdi:loading"
				class="size-6 animate-spin text-muted"
			/>
		</div>

		<div
			v-else-if="results.length"
			class="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900"
		>
			<NuxtLink
				v-for="result in results"
				:key="result.id"
				:to="linkFor(result)"
				class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
			>
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2">
						<span class="truncate text-sm font-medium">{{ result.title }}</span>
						<span class="shrink-0 font-mono text-xs text-slate-400">#{{ result.id }}</span>
					</div>
					<p class="text-xs text-slate-500">Opened {{ formatDate(result.created_at) }}</p>
				</div>
				<UBadge
					v-if="result.archived"
					color="neutral"
					variant="subtle"
					icon="mdi:archive-outline"
					class="shrink-0"
					>Archived</UBadge
				>
				<UBadge
					color="neutral"
					variant="subtle"
					class="shrink-0 capitalize"
					>{{ formatStatus(result.status) }}</UBadge
				>
				<UIcon
					name="mdi:chevron-right"
					class="size-5 shrink-0 text-slate-300"
				/>
			</NuxtLink>
		</div>

		<div
			v-else-if="searched"
			class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-200 py-12 text-center dark:border-slate-800"
		>
			<UIcon
				name="mdi:file-search-outline"
				class="size-10 text-muted"
			/>
			<p class="text-sm font-semibold">No Tickets Found</p>
			<p class="max-w-xs text-xs text-muted">{{ emptyHint }}</p>
		</div>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{ archived?: boolean }>();

type SearchResult = {
	id: number;
	title: string;
	status: string;
	archived?: boolean;
	created_at: string | number | Date;
	token: string;
};

const q = ref('');
const results = ref<SearchResult[]>([]);
const pending = ref(false);
const searched = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

const emptyHint = computed(() =>
	props.archived
		? 'No archived requests match yet. Try a different search.'
		: 'Try a different search, or check back later.'
);

async function run() {
	const term = q.value.trim();
	pending.value = true;
	try {
		const data = await $fetch<{ results: SearchResult[] }>('/api/public/search', {
			// omit archived unless active so the flag stays truthy-only on the server
			query: { q: term || undefined, ...(props.archived ? { archived: 1 } : {}) }
		});
		results.value = data.results;
	} catch {
		results.value = [];
	} finally {
		pending.value = false;
		searched.value = true;
	}
}

// debounce keystrokes; switching tabs re-runs immediately
watch(q, () => {
	if (timer) clearTimeout(timer);
	timer = setTimeout(run, 300);
});
watch(
	() => props.archived,
	() => run()
);

// browse the most recent tickets on load (empty query is a valid browse)
onMounted(run);

function linkFor(result: SearchResult): string {
	return `/status/${encodeURIComponent(result.token)}?id=${result.id}`;
}

function formatStatus(value: string): string {
	return value.replace(/_/g, ' ');
}

function formatDate(value: string | number | Date): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}
</script>
