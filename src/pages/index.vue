<template>
	<div class="relative overflow-hidden">
		<div
			class="pointer-events-none absolute inset-0 -z-10 bg-linear-to-b from-primary-50 to-white dark:from-slate-900 dark:to-slate-950"
		/>
		<section
			class="mx-auto flex w-full max-w-5xl flex-col items-center px-4 py-20 text-center sm:px-8 sm:py-28"
		>
			<UIcon
				name="mdi:lifebuoy"
				class="size-14 text-primary"
			/>
			<h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
				{{ siteName }}
			</h1>
			<p class="mt-4 max-w-2xl text-lg text-muted sm:text-xl">
				{{ siteDescription }}
			</p>
			<div class="mt-10 flex flex-col gap-3 sm:flex-row">
				<UButton
					to="/submit"
					size="xl"
					color="primary"
					icon="mdi:ticket-outline"
				>
					Submit a Request
				</UButton>
				<UButton
					to="/login"
					size="xl"
					color="neutral"
					variant="subtle"
					trailing-icon="mdi:login-variant"
				>
					Staff Login
				</UButton>
			</div>
		</section>

		<section class="mx-auto grid w-full max-w-5xl gap-6 px-4 pb-24 sm:grid-cols-3 sm:px-8">
			<UCard
				v-for="feature in features"
				:key="feature.title"
			>
				<div class="flex flex-col items-start gap-3">
					<UIcon
						:name="feature.icon"
						class="size-8 text-primary"
					/>
					<h2 class="text-lg font-semibold">{{ feature.title }}</h2>
					<p class="text-sm text-muted">{{ feature.body }}</p>
				</div>
			</UCard>
		</section>
	</div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' });

const { settings } = useSettings();

const siteName = computed(() => (settings.value?.name as string) || 'Smoke');
const siteDescription = computed(
	() =>
		(settings.value?.description as string) ||
		'Get help fast. Submit a request and track its status from anywhere.'
);

const features = [
	{
		icon: 'mdi:send-outline',
		title: 'Submit in Seconds',
		body: 'Send us a request with just your email and a short description.'
	},
	{
		icon: 'mdi:radar',
		title: 'Track Anytime',
		body: 'Use your status link to follow every update on your ticket.'
	},
	{
		icon: 'mdi:email-fast-outline',
		title: 'Replies by Email',
		body: 'Our team responds straight to your inbox; just reply to continue.'
	}
];

useSeoMeta({ title: () => siteName.value, description: () => siteDescription.value });
</script>
