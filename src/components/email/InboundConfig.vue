<template>
	<div
		class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
	>
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0">
				<p class="text-sm font-medium">Inbound Mailbox (IMAP / POP3)</p>
				<p class="text-xs text-slate-500">
					Inbound polling lets you receive email without Cloudflare Email Routing; it checks the
					mailbox every 15 minutes.
				</p>
			</div>
			<USwitch v-model="form.enabled" />
		</div>

		<template v-if="form.enabled">
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<UFormField label="Protocol">
					<USelect
						v-model="form.protocol"
						:items="protocolItems"
						class="w-full"
					/>
				</UFormField>
				<UFormField label="TLS">
					<USelect
						v-model="form.tls"
						:items="tlsItems"
						class="w-full"
					/>
				</UFormField>
			</div>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<UFormField label="Host">
					<UInput
						v-model="form.host"
						placeholder="imap.example.com"
						class="w-full"
					/>
				</UFormField>
				<UFormField label="Port">
					<UInput
						v-model.number="form.port"
						type="number"
						class="w-full"
					/>
				</UFormField>
			</div>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<UFormField label="Username">
					<UInput
						v-model="form.username"
						autocomplete="off"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Password"
					help="Sealed at rest; leave blank to keep the current password."
				>
					<UInput
						v-model="form.password"
						type="password"
						autocomplete="off"
						:placeholder="hasPassword ? 'Configured' : ''"
						class="w-full"
					/>
				</UFormField>
			</div>
		</template>

		<div
			class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800"
		>
			<UButton
				color="neutral"
				variant="soft"
				icon="mdi:email-sync-outline"
				:loading="polling"
				@click="pollNow"
				>Poll Now</UButton
			>
			<UButton
				color="primary"
				icon="mdi:content-save-outline"
				:loading="saving"
				@click="submit"
				>Save Inbound Channel</UButton
			>
		</div>
	</div>
</template>

<script setup lang="ts">
const toast = useToast();
const { settings, fetchSettings, saveEmail } = useSettings();
const { sessionToken } = useAuth();

const protocolItems = [
	{ label: 'IMAP', value: 'imap' },
	{ label: 'POP3', value: 'pop3' }
];
const tlsItems = [
	{ label: 'Implicit', value: 'implicit' },
	{ label: 'STARTTLS', value: 'starttls' },
	{ label: 'Off', value: 'off' }
];

const form = reactive({
	enabled: false,
	protocol: 'imap' as 'imap' | 'pop3',
	host: '',
	port: 993,
	tls: 'implicit' as 'implicit' | 'starttls' | 'off',
	username: '',
	password: ''
});
const hasPassword = ref(false);

const saving = ref(false);
const polling = ref(false);

// hydrate from the persisted email.poll config once settings load
watch(
	settings,
	(value) => {
		const poll = (value?.email as Record<string, any>)?.poll as Record<string, any> | undefined;
		if (!poll) return;
		form.enabled = !!poll.enabled;
		form.protocol = poll.protocol === 'pop3' ? 'pop3' : 'imap';
		form.host = poll.host || '';
		form.port = poll.port || (form.protocol === 'pop3' ? 995 : 993);
		form.tls = poll.tls || 'implicit';
		form.username = poll.username || '';
		hasPassword.value = !!poll.has_password;
	},
	{ immediate: true }
);

function authHeaders(): Record<string, string> {
	return sessionToken.value ? { Authorization: `Bearer ${sessionToken.value}` } : {};
}

async function submit() {
	saving.value = true;
	try {
		const poll: Record<string, unknown> = {
			enabled: form.enabled,
			protocol: form.protocol,
			host: form.host.trim(),
			port: form.port,
			tls: form.tls,
			username: form.username.trim()
		};
		// an empty password keeps the existing sealed value
		if (form.password) poll.password = form.password;
		await saveEmail({ poll });
		form.password = '';
		await fetchSettings(true);
		toast.add({
			title: 'Inbound Channel Saved',
			description: 'Your inbound mailbox settings were updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Save Inbound Channel',
			description: extractServerMessage(
				error,
				'Could not save the inbound mailbox. Please try again.'
			),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}

async function pollNow() {
	polling.value = true;
	try {
		const result = await $fetch<{ processed: number }>('/api/cloudflare/poll', {
			method: 'POST',
			credentials: 'include',
			headers: authHeaders()
		});
		const processed = result?.processed ?? 0;
		toast.add({
			title: 'Mailbox Polled',
			description: `Processed ${processed} new ${processed === 1 ? 'message' : 'messages'}.`,
			icon: 'mdi:email-check-outline',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Poll Mailbox',
			description: extractServerMessage(
				error,
				'Could not poll the inbound mailbox. Please try again.'
			),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		polling.value = false;
	}
}
</script>
