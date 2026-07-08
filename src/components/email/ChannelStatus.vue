<template>
	<div
		class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
	>
		<div class="flex items-center gap-3">
			<span
				:class="[
					'flex size-9 shrink-0 items-center justify-center rounded-full',
					configured
						? 'bg-green-50 text-green-600 dark:bg-green-950'
						: 'bg-slate-100 text-slate-400 dark:bg-slate-800'
				]"
			>
				<UIcon
					:name="configured ? 'mdi:email-check-outline' : 'mdi:email-off-outline'"
					class="size-5"
				/>
			</span>
			<div class="min-w-0 flex-1">
				<p class="text-sm font-medium">{{ transportLabel }}</p>
				<p class="truncate text-xs text-slate-500">{{ detail }}</p>
			</div>
			<UBadge
				:color="configured ? 'success' : 'warning'"
				variant="subtle"
				>{{ configured ? 'Active' : 'Not Configured' }}</UBadge
			>
		</div>
	</div>
</template>

<script setup lang="ts">
type EmailSettings = {
	transport?: 'cloudflare' | 'smtp';
	support_email?: string;
	smtp?: { host?: string; from?: string };
};

const { settings } = useSettings();

const email = computed<EmailSettings>(() => (settings.value?.email as EmailSettings) || {});
const transport = computed(() => email.value.transport || 'cloudflare');

const configured = computed(() => {
	if (transport.value === 'smtp') return !!email.value.smtp?.host;
	return !!(email.value.support_email || settings.value?.supportEmail);
});

const transportLabel = computed(() =>
	transport.value === 'smtp' ? 'Custom SMTP' : 'Cloudflare Email Service'
);

const detail = computed(() => {
	if (transport.value === 'smtp') {
		return email.value.smtp?.host
			? `Sending via ${email.value.smtp.host}`
			: 'No SMTP host configured yet.';
	}
	const support = email.value.support_email || (settings.value?.supportEmail as string);
	return support ? `Sending as ${support}` : 'No support address configured yet.';
});
</script>
