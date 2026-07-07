<template>
	<footer
		class="border-t border-slate-200 bg-white px-4 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 sm:px-6"
	>
		<div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 sm:flex-row">
			<span>&copy; {{ year }} {{ brandName }}. All rights reserved.</span>
			<div class="flex items-center gap-4">
				<NuxtLink
					v-if="website"
					:to="website"
					class="hover:text-primary-500"
					target="_blank"
					>Website</NuxtLink
				>
				<NuxtLink
					to="/dashboard"
					class="hover:text-primary-500"
					>Dashboard</NuxtLink
				>
			</div>
		</div>
	</footer>
</template>

<script setup lang="ts">
const { settings } = useSettings();

const year = new Date().getFullYear();
const brandName = computed(() => (settings.value?.name as string) || 'Smoke');
const website = computed(() => (settings.value?.website as string) || '');
</script>
