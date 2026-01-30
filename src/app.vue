<template>
	<UApp :toaster="{ expand: false }">
		<NuxtLayout>
			<NuxtPage />
		</NuxtLayout>
	</UApp>
</template>

<script setup lang="ts">
useHead({
	link: [
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
