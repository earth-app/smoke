<template>
	<div
		class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
	>
		<div class="flex items-center gap-3">
			<span
				:class="[
					'flex size-9 shrink-0 items-center justify-center rounded-full',
					view.tone === 'success'
						? 'bg-green-50 text-green-600 dark:bg-green-950'
						: view.tone === 'warning'
							? 'bg-amber-50 text-amber-600 dark:bg-amber-950'
							: 'bg-slate-100 text-slate-400 dark:bg-slate-800'
				]"
			>
				<UIcon
					:name="view.icon"
					class="size-5"
				/>
			</span>
			<div class="min-w-0 flex-1">
				<p class="text-sm font-medium">{{ transportLabel }}</p>
				<p class="truncate text-xs text-slate-500">{{ view.detail }}</p>
			</div>
			<UBadge
				:color="view.tone"
				variant="subtle"
				>{{ view.label }}</UBadge
			>
		</div>
	</div>
</template>

<script setup lang="ts">
type EmailConfigStatus = {
	configured: boolean;
	transport: 'cloudflare' | 'smtp' | null;
	needsOnboarding: boolean;
	reason?: string;
};

const { settings } = useSettings();
const { sessionToken } = useAuth();
const requestFetch = useRequestFetch();

const status = ref<EmailConfigStatus | null>(null);
// true until the first status resolves; keeps the card from flashing "Not Configured" on (re)mount
const loading = ref(true);

async function refresh() {
	try {
		const headers: Record<string, string> = {};
		if (sessionToken.value) headers.Authorization = `Bearer ${sessionToken.value}`;
		status.value = await requestFetch<EmailConfigStatus>('/api/cloudflare/email-status', {
			cache: 'no-store',
			credentials: 'include',
			headers
		});
	} catch {
		status.value = null;
	} finally {
		loading.value = false;
	}
}

onMounted(refresh);
watch(settings, refresh);

const transportLabel = computed(() =>
	(status.value?.transport ?? 'cloudflare') === 'smtp' ? 'Custom SMTP' : 'Cloudflare Email Service'
);

const view = computed(() => {
	const s = status.value;
	// initial load: show a neutral "Checking" state rather than the misleading "Not Configured"
	if (!s && loading.value) {
		return {
			tone: 'neutral' as const,
			icon: 'mdi:loading',
			label: 'Checking',
			detail: 'Checking email configuration...'
		};
	}
	if (s?.configured) {
		return {
			tone: 'success' as const,
			icon: 'mdi:email-check-outline',
			label: 'Configured',
			detail: s.reason || 'Ready to send outbound email.'
		};
	}
	if (s?.needsOnboarding) {
		return {
			tone: 'warning' as const,
			icon: 'mdi:email-alert-outline',
			label: 'Needs Onboarding',
			detail: s.reason || 'Verify your domain for Cloudflare Email Sending to finish setup.'
		};
	}
	return {
		tone: 'neutral' as const,
		icon: 'mdi:email-off-outline',
		label: 'Not Configured',
		detail: s?.reason || 'Add an email transport to start sending.'
	};
});

defineExpose({ refresh, status });
</script>
