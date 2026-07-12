<template>
	<div
		class="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-12 text-center"
	>
		<template v-if="state === 'resolving'">
			<Skeleton
				variant="rect"
				width="3rem"
				height="3rem"
				rounded="rounded-full"
			/>
			<Skeleton
				variant="line"
				width="12rem"
				height="1rem"
			/>
			<p class="text-sm text-muted">Signing You In...</p>
		</template>

		<template v-else>
			<UIcon
				name="mdi:link-variant-off"
				class="size-12 text-error"
			/>
			<h1 class="text-xl font-semibold">Link No Longer Valid</h1>
			<p class="max-w-sm text-muted">{{ errorMessage }}</p>
			<UButton
				to="/portal/login"
				color="primary"
				icon="mdi:login-variant"
			>
				Sign in with a Code
			</UButton>
		</template>
	</div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' });

const route = useRoute();
const { fetchCustomer } = useCustomerAuth();

const state = ref<'resolving' | 'error'>('resolving');
const errorMessage = ref('This access link has expired or is no longer valid.');

onMounted(async () => {
	const token = String(route.params.token || '');
	if (!token) {
		state.value = 'error';
		return;
	}

	try {
		await $fetch(`/api/portal/magic/${encodeURIComponent(token)}`, {
			cache: 'no-store',
			credentials: 'include'
		});
		// hydrate the now-signed-in customer before the portal reads its cached state
		await fetchCustomer(true);
		await navigateTo('/portal');
	} catch (error) {
		errorMessage.value = extractServerMessage(error, 'This access link has expired.');
		state.value = 'error';
	}
});

useSeoMeta({ title: 'Signing In', robots: 'noindex, nofollow' });
</script>
