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
			v-if="state === 'active'"
			color="success"
			variant="subtle"
			icon="mdi:shield-check-outline"
			title="Bot Protection (Turnstile) is Active"
			description="Public forms are verified with Cloudflare Turnstile."
		/>
		<UAlert
			v-else-if="state === 'secret-missing'"
			color="error"
			variant="subtle"
			icon="mdi:shield-half-full"
			title="Bot Protection is Half-Configured"
			description="The public site key is set, but the secret key is missing, so Turnstile stays OFF (the widget can't be verified server-side). Set NUXT_TURNSTILE_SECRET_KEY to finish enabling it."
		/>
		<UAlert
			v-else-if="state === 'site-missing'"
			color="error"
			variant="subtle"
			icon="mdi:shield-half-full"
			title="Bot Protection is Half-Configured"
			description="The secret key is set, but the public site key is missing, so Turnstile stays OFF (the widget won't render on forms). Set NUXT_PUBLIC_TURNSTILE_SITE_KEY to finish enabling it."
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

// active (both keys) | secret-missing (site only) | site-missing (secret only) | disabled (neither)
const state = computed<'active' | 'secret-missing' | 'site-missing' | 'disabled'>(() => {
	const t = settings.value?.turnstile;
	if (!t) return 'disabled';
	if (t.configured) return 'active';
	if (t.hasSiteKey && !t.hasSecretKey) return 'secret-missing';
	if (!t.hasSiteKey && t.hasSecretKey) return 'site-missing';
	return 'disabled';
});
</script>
