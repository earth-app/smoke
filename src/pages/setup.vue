<template>
	<div class="mx-auto w-full max-w-xl px-4 py-12 sm:px-8">
		<div class="mb-8 text-center">
			<UIcon
				name="mdi:rocket-launch"
				class="mx-auto size-12 text-primary"
			/>
			<h1 class="mt-3 text-3xl font-bold">Welcome to Smoke</h1>
			<p class="mt-2 text-muted">Let's set up your support platform in a few quick steps.</p>
		</div>

		<div class="mb-8 flex items-center justify-center gap-2">
			<template
				v-for="s in steps"
				:key="s.index"
			>
				<div
					class="flex size-8 items-center justify-center rounded-full text-sm font-semibold transition-colors"
					:class="step >= s.index ? 'bg-primary text-inverted' : 'bg-elevated text-muted'"
				>
					<UIcon
						v-if="step > s.index"
						name="mdi:check"
						class="size-4"
					/>
					<span v-else>{{ s.index + 1 }}</span>
				</div>
				<div
					v-if="s.index < steps.length - 1"
					class="h-px w-6 sm:w-10"
					:class="step > s.index ? 'bg-primary' : 'bg-accented'"
				/>
			</template>
		</div>

		<UCard>
			<div class="min-h-72 space-y-4">
				<div v-show="step === 0">
					<h2 class="mb-1 text-xl font-semibold">Admin Account</h2>
					<p class="mb-4 text-sm text-muted">Create the first administrator for this platform.</p>
					<div class="space-y-4">
						<UFormField
							label="Username"
							hint="3-64 characters"
						>
							<UInput
								v-model="username"
								autocomplete="username"
								placeholder="admin"
								class="w-full"
							/>
						</UFormField>
						<UFormField label="Email">
							<UInput
								v-model="email"
								type="email"
								autocomplete="email"
								placeholder="admin@example.com"
								class="w-full"
							/>
						</UFormField>
						<UFormField
							label="Password"
							hint="8+ chars, upper, lower, number, symbol"
						>
							<UInput
								v-model="password"
								type="password"
								autocomplete="new-password"
								class="w-full"
							/>
						</UFormField>
						<UFormField label="Confirm Password">
							<UInput
								v-model="confirm"
								type="password"
								autocomplete="new-password"
								class="w-full"
							/>
						</UFormField>
					</div>
				</div>

				<div v-show="step === 1">
					<h2 class="mb-1 text-xl font-semibold">Email Channel</h2>
					<p class="mb-4 text-sm text-muted">Choose how outbound support emails are delivered.</p>
					<div class="space-y-4">
						<UFormField label="Delivery Method">
							<USelect
								v-model="emailMode"
								:items="emailModeItems"
								class="w-full"
							/>
						</UFormField>

						<div
							v-if="emailMode === 'cloudflare'"
							class="space-y-4"
						>
							<UFormField
								label="Support Email"
								hint="Domain must be onboarded to Cloudflare Email Sending"
							>
								<UInput
									v-model="supportEmail"
									type="email"
									placeholder="support@example.com"
									class="w-full"
								/>
							</UFormField>
						</div>

						<div
							v-else
							class="space-y-4"
						>
							<div class="grid gap-4 sm:grid-cols-2">
								<UFormField label="SMTP Host">
									<UInput
										v-model="smtp.host"
										placeholder="smtp.example.com"
										class="w-full"
									/>
								</UFormField>
								<UFormField label="Port">
									<UInput
										v-model.number="smtp.port"
										type="number"
										placeholder="465"
										class="w-full"
									/>
								</UFormField>
							</div>
							<UFormField label="Use TLS">
								<USwitch v-model="smtp.tls" />
							</UFormField>
							<div class="grid gap-4 sm:grid-cols-2">
								<UFormField label="Username">
									<UInput
										v-model="smtp.user"
										autocomplete="off"
										class="w-full"
									/>
								</UFormField>
								<UFormField label="Password">
									<UInput
										v-model="smtp.pass"
										type="password"
										autocomplete="off"
										class="w-full"
									/>
								</UFormField>
							</div>
							<UFormField label="From Address">
								<UInput
									v-model="smtp.from"
									type="email"
									placeholder="support@example.com"
									class="w-full"
								/>
							</UFormField>
						</div>
					</div>
				</div>

				<div v-show="step === 2">
					<h2 class="mb-1 text-xl font-semibold">Branding</h2>
					<p class="mb-4 text-sm text-muted">Optional; you can change this later in settings.</p>
					<div class="space-y-4">
						<UFormField label="Site Name">
							<UInput
								v-model="name"
								placeholder="Smoke"
								class="w-full"
							/>
						</UFormField>
						<UFormField label="Description">
							<UTextarea
								v-model="description"
								:rows="3"
								placeholder="A short tagline for your support portal"
								class="w-full"
							/>
						</UFormField>
					</div>
				</div>

				<div v-show="step === 3">
					<h2 class="mb-1 text-xl font-semibold">Ready to Finish</h2>
					<p class="mb-4 text-sm text-muted">Review your setup and create your platform.</p>
					<div class="space-y-2 text-sm">
						<div class="flex justify-between gap-4">
							<span class="text-muted">Admin Username</span>
							<span class="font-medium">{{ username || '-' }}</span>
						</div>
						<div class="flex justify-between gap-4">
							<span class="text-muted">Admin Email</span>
							<span class="font-medium">{{ email || '-' }}</span>
						</div>
						<div class="flex justify-between gap-4">
							<span class="text-muted">Email Channel</span>
							<span class="font-medium">
								{{ emailMode === 'cloudflare' ? 'Cloudflare Email Service' : 'Custom SMTP' }}
							</span>
						</div>
						<div class="flex justify-between gap-4">
							<span class="text-muted">Site Name</span>
							<span class="font-medium">{{ name || 'Smoke' }}</span>
						</div>
					</div>
				</div>

				<UAlert
					v-if="error"
					color="error"
					variant="subtle"
					icon="mdi:alert-circle"
					:title="error"
				/>
			</div>

			<template #footer>
				<div class="flex items-center justify-between">
					<UButton
						color="neutral"
						variant="ghost"
						icon="mdi:arrow-left"
						:disabled="step === 0 || submitting"
						@click="back"
					>
						Back
					</UButton>
					<UButton
						v-if="step < steps.length - 1"
						color="primary"
						trailing-icon="mdi:arrow-right"
						@click="next"
					>
						Next
					</UButton>
					<UButton
						v-else
						color="primary"
						icon="mdi:check"
						:loading="submitting"
						@click="finish"
					>
						Finish Setup
					</UButton>
				</div>
			</template>
		</UCard>
	</div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' });

const toast = useToast();
const { setSessionToken } = useAuth();
const { status, refresh } = useSetupStatus();

await refresh();
if (status.value && !status.value.needsSetup) {
	await navigateTo('/login');
}

const steps = [
	{ index: 0, label: 'Admin Account' },
	{ index: 1, label: 'Email Channel' },
	{ index: 2, label: 'Branding' },
	{ index: 3, label: 'Finish' }
];

const step = ref(0);
const submitting = ref(false);
const error = ref('');

const username = ref('admin');
const email = ref('');
const password = ref('');
const confirm = ref('');

const emailMode = ref<'cloudflare' | 'smtp'>('cloudflare');
const emailModeItems = [
	{ label: 'Cloudflare Email Service', value: 'cloudflare' },
	{ label: 'Custom SMTP', value: 'smtp' }
];
const supportEmail = ref('');
const smtp = ref({ host: '', port: 465, tls: true, user: '', pass: '', from: '' });

const name = ref('');
const description = ref('');

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateStep(index: number): string {
	if (index === 0) {
		if (username.value.trim().length < 3) return 'Username must be at least 3 characters';
		if (!emailRe.test(email.value.trim())) return 'Enter a valid email address';
		if (password.value.length < 8) return 'Password must be at least 8 characters';
		if (!/[a-z]/.test(password.value)) return 'Password must contain a lowercase letter';
		if (!/[A-Z]/.test(password.value)) return 'Password must contain an uppercase letter';
		if (!/\d/.test(password.value)) return 'Password must contain a number';
		if (!/[@$!%*?&]/.test(password.value))
			return 'Password must contain a special character (@, $, !, %, *, ?, &)';
		if (password.value !== confirm.value) return 'Passwords do not match';
	}
	if (index === 1) {
		if (emailMode.value === 'cloudflare') {
			if (!emailRe.test(supportEmail.value.trim())) return 'Enter a valid support email';
		} else {
			if (!smtp.value.host.trim()) return 'SMTP host is required';
			if (!smtp.value.port || smtp.value.port < 1) return 'Enter a valid SMTP port';
			if (!emailRe.test(smtp.value.from.trim())) return 'Enter a valid from address';
		}
	}
	return '';
}

function next() {
	const message = validateStep(step.value);
	if (message) {
		error.value = message;
		return;
	}
	error.value = '';
	if (step.value < steps.length - 1) step.value += 1;
}

function back() {
	error.value = '';
	if (step.value > 0) step.value -= 1;
}

function buildEmailSettings() {
	if (emailMode.value === 'cloudflare') {
		return { transport: 'cloudflare', support_email: supportEmail.value.trim() };
	}
	return {
		transport: 'smtp',
		support_email: smtp.value.from.trim(),
		smtp: {
			host: smtp.value.host.trim(),
			port: smtp.value.port,
			tls: smtp.value.tls ? 'implicit' : 'starttls',
			username: smtp.value.user.trim(),
			from: smtp.value.from.trim(),
			password: smtp.value.pass
		}
	};
}

async function finish() {
	for (let i = 0; i < steps.length - 1; i += 1) {
		const message = validateStep(i);
		if (message) {
			step.value = i;
			error.value = message;
			return;
		}
	}
	error.value = '';
	submitting.value = true;
	try {
		const response = await $fetch<{ session_token: string }>('/api/setup/init', {
			method: 'POST',
			credentials: 'include',
			body: {
				username: username.value.toLowerCase().trim(),
				email: email.value.trim(),
				password: password.value,
				settings: {
					email: buildEmailSettings(),
					name: name.value.trim(),
					description: description.value.trim()
				}
			}
		});
		setSessionToken(response.session_token);
		if (status.value) status.value = { ...status.value, needsSetup: false };
		toast.add({
			title: 'Setup Complete',
			description: 'Your support platform is ready.',
			icon: 'mdi:rocket-launch',
			color: 'success'
		});
		await navigateTo('/dashboard');
	} catch (e: any) {
		if (e?.statusCode === 409 || e?.data?.statusCode === 409) {
			if (status.value) status.value = { ...status.value, needsSetup: false };
			toast.add({
				title: 'Setup Already Completed',
				description: 'An administrator already exists. Please log in.',
				icon: 'mdi:information',
				color: 'info'
			});
			await navigateTo('/login');
			return;
		}
		error.value =
			e?.data?.message || e?.data?.statusMessage || e?.message || 'Setup failed; please try again.';
	} finally {
		submitting.value = false;
	}
}

useSeoMeta({ title: 'Setup' });
</script>
