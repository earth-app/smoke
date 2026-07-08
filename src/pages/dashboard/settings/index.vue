<template>
	<div class="mx-auto flex max-w-4xl flex-col gap-5">
		<div>
			<h1 class="text-2xl font-semibold">Settings</h1>
			<p class="text-sm text-slate-500">Configure branding, email delivery, and infrastructure.</p>
		</div>

		<UTabs
			v-model="tab"
			:items="tabItems"
			class="w-full"
		>
			<template #branding>
				<div
					class="mt-4 flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
				>
					<UFormField
						label="Name"
						help="Displayed in the sidebar, navbar, and emails."
					>
						<UInput
							v-model="branding.name"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Description">
						<UTextarea
							v-model="branding.description"
							:rows="2"
							class="w-full"
						/>
					</UFormField>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<UFormField label="Theme Color">
							<input
								v-model="branding.themeColor"
								type="color"
								class="h-9 w-full cursor-pointer rounded border border-slate-200 dark:border-slate-700"
							/>
						</UFormField>
						<UFormField label="Logo URL">
							<UInput
								v-model="branding.faviconPng"
								placeholder="https://..."
								class="w-full"
							/>
						</UFormField>
					</div>
					<UFormField label="Website">
						<UInput
							v-model="branding.website"
							placeholder="https://..."
							class="w-full"
						/>
					</UFormField>
					<div class="flex justify-end">
						<UButton
							color="primary"
							icon="mdi:content-save-outline"
							:loading="savingBranding"
							@click="saveBranding"
							>Save Branding</UButton
						>
					</div>
				</div>
			</template>

			<template #email>
				<div class="mt-4 flex flex-col gap-4">
					<EmailChannelStatus />

					<div
						class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
					>
						<UFormField
							label="Transport"
							help="Cloudflare Email Service is recommended for most teams."
						>
							<USelect
								v-model="emailForm.transport"
								:items="transportItems"
								class="w-full"
							/>
						</UFormField>

						<UFormField
							label="Support Email"
							help="The address customers reply to."
						>
							<UInput
								v-model="emailForm.support_email"
								type="email"
								placeholder="support@example.com"
								class="w-full"
							/>
						</UFormField>

						<template v-if="emailForm.transport === 'smtp'">
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<UFormField label="SMTP Host">
									<UInput
										v-model="emailForm.smtp.host"
										placeholder="smtp.example.com"
										class="w-full"
									/>
								</UFormField>
								<UFormField label="Port">
									<UInput
										v-model.number="emailForm.smtp.port"
										type="number"
										class="w-full"
									/>
								</UFormField>
							</div>
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<UFormField label="TLS">
									<USelect
										v-model="emailForm.smtp.tls"
										:items="tlsItems"
										class="w-full"
									/>
								</UFormField>
								<UFormField label="From Address">
									<UInput
										v-model="emailForm.smtp.from"
										placeholder="support@example.com"
										class="w-full"
									/>
								</UFormField>
							</div>
							<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
								<UFormField label="Username">
									<UInput
										v-model="emailForm.smtp.username"
										class="w-full"
									/>
								</UFormField>
								<UFormField
									label="Password"
									help="Sealed at rest; leave blank to keep the current password."
								>
									<UInput
										v-model="emailForm.smtp.password"
										type="password"
										class="w-full"
									/>
								</UFormField>
							</div>
						</template>

						<div
							class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800"
						>
							<div class="flex items-end gap-2">
								<UFormField
									label="Test Recipient"
									size="sm"
								>
									<UInput
										v-model="testEmail"
										type="email"
										placeholder="you@example.com"
										class="w-56"
									/>
								</UFormField>
								<UButton
									color="neutral"
									variant="soft"
									icon="mdi:email-fast-outline"
									:loading="sendingTest"
									:disabled="!testEmail.trim()"
									@click="sendTest"
									>Send Test Email</UButton
								>
							</div>
							<UButton
								color="primary"
								icon="mdi:content-save-outline"
								:loading="savingEmail"
								@click="saveEmail"
								>Save Email Channel</UButton
							>
						</div>
					</div>
				</div>
			</template>

			<template #cloudflare>
				<div class="mt-4">
					<CloudflareAccountCard />
				</div>
			</template>

			<template #danger>
				<div
					class="mt-4 flex flex-col gap-4 rounded-lg border border-red-200 bg-red-50/50 p-5 dark:border-red-900/50 dark:bg-red-950/20"
				>
					<div>
						<h3 class="text-sm font-semibold text-red-700 dark:text-red-400">Danger Zone</h3>
						<p class="text-xs text-slate-500">
							These actions are irreversible. Proceed with caution.
						</p>
					</div>
					<div
						class="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-white p-4 dark:border-red-900/50 dark:bg-slate-900"
					>
						<div>
							<p class="text-sm font-medium">Reset Branding</p>
							<p class="text-xs text-slate-500">Clear the name, description, and theme color.</p>
						</div>
						<UButton
							color="error"
							variant="soft"
							icon="mdi:backup-restore"
							:loading="resetting"
							@click="resetBranding"
							>Reset</UButton
						>
					</div>
				</div>
			</template>
		</UTabs>
	</div>
</template>

<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui';

definePageMeta({ layout: 'dashboard', middleware: 'admin' });

const toast = useToast();
const { settings, fetchSettings, save, sendTestEmail } = useSettings();

const tab = ref('branding');

const tabItems: TabsItem[] = [
	{ label: 'Branding', slot: 'branding', icon: 'mdi:palette-outline' },
	{ label: 'Email Channel', slot: 'email', icon: 'mdi:email-outline' },
	{ label: 'Cloudflare', slot: 'cloudflare', icon: 'mdi:cloud-outline' },
	{ label: 'Danger', slot: 'danger', icon: 'mdi:alert-outline' }
];

const branding = reactive({
	name: '',
	description: '',
	themeColor: '#3b82f6',
	faviconPng: '',
	website: ''
});

const emailForm = reactive({
	transport: 'cloudflare' as 'cloudflare' | 'smtp',
	support_email: '',
	smtp: {
		host: '',
		port: 587,
		tls: 'starttls' as 'implicit' | 'starttls' | 'off',
		username: '',
		from: '',
		password: ''
	}
});

const testEmail = ref('');

const savingBranding = ref(false);
const savingEmail = ref(false);
const sendingTest = ref(false);
const resetting = ref(false);

const transportItems = [
	{ label: 'Cloudflare Email Service', value: 'cloudflare' },
	{ label: 'Custom SMTP', value: 'smtp' }
];
const tlsItems = [
	{ label: 'Implicit (465)', value: 'implicit' },
	{ label: 'STARTTLS (587)', value: 'starttls' },
	{ label: 'Off', value: 'off' }
];

// hydrate the forms from the settings store once loaded
watch(
	settings,
	(value) => {
		if (!value) return;
		branding.name = (value.name as string) || '';
		branding.description = (value.description as string) || '';
		branding.themeColor = (value.themeColor as string) || '#3b82f6';
		branding.faviconPng = (value.faviconPng as string) || '';
		branding.website = (value.website as string) || '';

		const email = (value.email as Record<string, any>) || {};
		emailForm.transport = email.transport === 'smtp' ? 'smtp' : 'cloudflare';
		emailForm.support_email = email.support_email || (value.supportEmail as string) || '';
		if (email.smtp) {
			emailForm.smtp.host = email.smtp.host || '';
			emailForm.smtp.port = email.smtp.port || 587;
			emailForm.smtp.tls = email.smtp.tls || 'starttls';
			emailForm.smtp.username = email.smtp.username || '';
			emailForm.smtp.from = email.smtp.from || '';
		}
	},
	{ immediate: true }
);

async function saveBranding() {
	savingBranding.value = true;
	try {
		await save({
			name: branding.name,
			description: branding.description,
			themeColor: branding.themeColor,
			faviconPng: branding.faviconPng,
			website: branding.website
		});
		toast.add({
			title: 'Branding Saved',
			description: 'Your branding was updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch {
		toast.add({
			title: 'Failed to Save Branding',
			description: 'Could not save branding. Please try again.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		savingBranding.value = false;
	}
}

async function saveEmail() {
	savingEmail.value = true;
	try {
		const email: Record<string, unknown> = {
			transport: emailForm.transport,
			support_email: emailForm.support_email
		};
		if (emailForm.transport === 'smtp') {
			const smtp: Record<string, unknown> = {
				host: emailForm.smtp.host,
				port: emailForm.smtp.port,
				tls: emailForm.smtp.tls,
				username: emailForm.smtp.username,
				from: emailForm.smtp.from
			};
			if (emailForm.smtp.password) smtp.password = emailForm.smtp.password;
			email.smtp = smtp;
		}
		await save({ email });
		emailForm.smtp.password = '';
		await fetchSettings(true);
		toast.add({
			title: 'Email Channel Saved',
			description: 'Your email settings were updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch {
		toast.add({
			title: 'Failed to Save Email Channel',
			description: 'Could not save email settings. Please try again.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		savingEmail.value = false;
	}
}

async function sendTest() {
	sendingTest.value = true;
	try {
		await sendTestEmail(testEmail.value.trim());
		toast.add({
			title: 'Test Email Sent',
			description: `A test message was sent to ${testEmail.value.trim()}.`,
			icon: 'mdi:check',
			color: 'success',
			duration: 4000
		});
	} catch {
		toast.add({
			title: 'Failed to Send Test Email',
			description: 'Check your email configuration and try again.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		sendingTest.value = false;
	}
}

async function resetBranding() {
	if (!confirm('Reset branding to defaults?')) return;
	resetting.value = true;
	try {
		await save({ name: '', description: '', themeColor: '#3b82f6', faviconPng: '' });
		await fetchSettings(true);
		toast.add({
			title: 'Branding Reset',
			description: 'Branding was reset to defaults.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch {
		toast.add({
			title: 'Failed to Reset Branding',
			description: 'Could not reset branding. Please try again.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		resetting.value = false;
	}
}
</script>
