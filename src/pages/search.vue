<template>
	<div class="mx-auto w-full max-w-2xl px-4 py-12 sm:px-8">
		<div class="mb-8 text-center">
			<UIcon
				name="mdi:magnify"
				class="mx-auto size-12 text-primary"
			/>
			<h1 class="mt-3 text-3xl font-bold">Search Requests</h1>
			<p class="mt-2 text-muted">Find a public support request and follow its progress.</p>
		</div>

		<div class="mb-5 flex justify-center">
			<UTabs
				v-model="tab"
				:items="tabs"
				:content="false"
				color="primary"
			/>
		</div>

		<TicketPublicSearch
			:key="tab"
			:archived="tab === 'archived'"
		/>
	</div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' });

const tabs = [
	{ label: 'Open', value: 'open', icon: 'mdi:inbox-outline' },
	{ label: 'Archived', value: 'archived', icon: 'mdi:archive-outline' }
];
const tab = ref('open');

useSeoMeta({
	title: 'Search Requests',
	description: 'Search public support requests.',
	ogTitle: 'Search Requests',
	twitterCard: 'summary'
});
</script>
