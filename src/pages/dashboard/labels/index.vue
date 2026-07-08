<template>
	<div class="mx-auto flex max-w-3xl flex-col gap-5">
		<div>
			<h1 class="text-2xl font-semibold">Labels</h1>
			<p class="text-sm text-slate-500">
				Create and organize labels to categorize tickets and customers.
			</p>
		</div>

		<LabelManager />
	</div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'staff' });
</script>
