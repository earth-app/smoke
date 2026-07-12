<template>
	<div
		class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
	>
		<div>
			<h3 class="text-sm font-semibold">Bot Protection</h3>
			<p class="text-xs text-slate-500">
				Cloudflare Turnstile shields your public forms from automated abuse.
			</p>
		</div>

		<UAlert
			v-if="configured"
			color="success"
			variant="subtle"
			icon="mdi:shield-check-outline"
			title="Bot Protection (Turnstile) is Active"
			description="Public forms are verified with Cloudflare Turnstile."
		/>
		<UAlert
			v-else
			color="warning"
			variant="subtle"
			icon="mdi:shield-alert-outline"
			title="Bot Protection is Disabled"
			description="Cloudflare Turnstile credentials are missing, so public forms (ticket submission, replies, and file uploads) are not protected against bots and your site is less secure. Set NUXT_PUBLIC_TURNSTILE_SITE_KEY and NUXT_TURNSTILE_SECRET_KEY to enable it."
		/>
	</div>
</template>

<script setup lang="ts">
const { settings } = useSettings();

const configured = computed(() => !!settings.value?.turnstile?.configured);
</script>
