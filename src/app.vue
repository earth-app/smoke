<template>
	<UApp :toaster="{ expand: false }">
		<NuxtLayout>
			<NuxtPage />
		</NuxtLayout>
		<ClientOnly>
			<AppCommandPalette />
		</ClientOnly>
	</UApp>
</template>

<script setup lang="ts">
const { settings } = useSettings();
// the user-set instance name; falls back to the software brand until settings hydrate
const brand = computed(() => (settings.value?.name as string) || 'Smoke');

// global open-graph defaults; per-page useSeoMeta overrides title/description/ogImage
useSeoMeta({
	ogSiteName: () => brand.value,
	ogType: 'website',
	twitterCard: 'summary'
});

useHead({
	// every page title is suffixed with the instance name; a page with no title shows just the name
	titleTemplate: (title) =>
		!title ? brand.value : title === brand.value ? title : `${title} · ${brand.value}`,
	link: [
		// svg (iconify) is preferred when present; ico/png cover uploads + older browsers
		{
			rel: 'icon',
			type: 'image/svg+xml',
			href: '/favicon.svg'
		},
		{
			rel: 'icon',
			type: 'image/x-icon',
			href: '/favicon.ico'
		},
		{
			rel: 'icon',
			type: 'image/png',
			href: '/favicon.png'
		},
		{
			rel: 'apple-touch-icon',
			href: '/favicon.png'
		}
	]
});
</script>
