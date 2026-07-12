<template>
	<div class="mx-auto w-full max-w-xl px-4 py-12 sm:px-8">
		<div class="mb-8 text-center">
			<UIcon
				name="mdi:rocket-launch"
				class="mx-auto size-12 text-secondary"
			/>
			<h1 class="mt-3 text-3xl font-bold">Welcome to Smoke by The Earth App</h1>
			<p class="mt-2 text-muted">Let's set up your support platform in a few quick steps.</p>
		</div>

		<div class="mb-8 flex items-center justify-center gap-2">
			<template
				v-for="s in steps"
				:key="s.index"
			>
				<div
					class="flex size-8 items-center justify-center rounded-full text-sm font-semibold transition-colors"
					:class="
						step > s.index
							? 'bg-secondary text-inverted'
							: step === s.index
								? 'bg-primary text-inverted'
								: 'bg-elevated text-muted'
					"
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
					:class="step > s.index ? 'bg-secondary' : 'bg-accented'"
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
						<div class="grid gap-4 sm:grid-cols-2">
							<UFormField
								label="First Name"
								hint="Optional"
								help="Shown in place of the username across the dashboard."
							>
								<UInput
									v-model="firstName"
									autocomplete="given-name"
									placeholder="Ada"
									class="w-full"
								/>
							</UFormField>
							<UFormField
								label="Last Name"
								hint="Optional"
							>
								<UInput
									v-model="lastName"
									autocomplete="family-name"
									placeholder="Lovelace"
									class="w-full"
								/>
							</UFormField>
						</div>
						<UFormField
							label="Password"
							hint="12+ chars, upper, lower, number, symbol"
						>
							<UInput
								v-model="password"
								type="password"
								autocomplete="new-password"
								class="w-full"
							/>
							<PasswordStrength
								:password="password"
								class="mt-2"
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
						<UFormField
							label="Avatar"
							hint="Optional"
							help="An Iconify icon name or an image URL."
						>
							<div class="flex items-center gap-3">
								<Avatar
									:avatar="adminAvatarResolved"
									:name="username"
									size="md"
								/>
								<UInput
									v-model="adminAvatar"
									placeholder="mdi:shield-account"
									class="flex-1"
								/>
							</div>
						</UFormField>
					</div>
				</div>

				<div v-show="step === 1">
					<h2 class="mb-1 text-xl font-semibold">Email Channel</h2>
					<p class="mb-4 text-sm text-muted">Configure how support email is sent and received.</p>
					<div class="space-y-6">
						<div class="space-y-4">
							<div>
								<h3 class="text-sm font-semibold">Sending (Outbound)</h3>
								<p class="text-xs text-muted">Choose how outbound support emails are delivered.</p>
							</div>
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

						<div class="space-y-4 border-t border-slate-100 pt-4 dark:border-slate-800">
							<div>
								<h3 class="text-sm font-semibold">Receiving (Inbound)</h3>
								<p class="text-xs text-muted">Choose how incoming customer email reaches Smoke.</p>
							</div>
							<UFormField label="Inbound Method">
								<USelect
									v-model="inboundMode"
									:items="inboundModeItems"
									class="w-full"
								/>
							</UFormField>

							<UAlert
								v-if="inboundMode === 'cloudflare'"
								color="info"
								variant="subtle"
								icon="mdi:information-outline"
								title="Cloudflare Email Routing"
								description="Provision routing in the Cloudflare step so replies route back to this worker."
							/>

							<div
								v-else-if="inboundMode === 'imap'"
								class="space-y-4"
							>
								<div class="grid gap-4 sm:grid-cols-2">
									<UFormField label="Protocol">
										<USelect
											v-model="poll.protocol"
											:items="pollProtocolItems"
											class="w-full"
										/>
									</UFormField>
									<UFormField label="TLS">
										<USelect
											v-model="poll.tls"
											:items="pollTlsItems"
											class="w-full"
										/>
									</UFormField>
								</div>
								<div class="grid gap-4 sm:grid-cols-2">
									<UFormField label="Host">
										<UInput
											v-model="poll.host"
											placeholder="imap.example.com"
											class="w-full"
										/>
									</UFormField>
									<UFormField label="Port">
										<UInput
											v-model.number="poll.port"
											type="number"
											class="w-full"
										/>
									</UFormField>
								</div>
								<div class="grid gap-4 sm:grid-cols-2">
									<UFormField label="Username">
										<UInput
											v-model="poll.username"
											autocomplete="off"
											class="w-full"
										/>
									</UFormField>
									<UFormField label="Password">
										<UInput
											v-model="poll.password"
											type="password"
											autocomplete="off"
											class="w-full"
										/>
									</UFormField>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div v-show="step === 2">
					<h2 class="mb-1 text-xl font-semibold">Cloudflare (Optional)</h2>
					<p class="mb-4 text-sm text-muted">
						Link a Cloudflare account to auto-provision email routing, or skip and add it later in
						Settings.
					</p>
					<div class="space-y-4">
						<UFormField label="Account ID">
							<UInput
								v-model="cfAccountId"
								placeholder="Cloudflare Account ID"
								class="w-full"
							/>
						</UFormField>
						<UFormField
							label="API Token"
							help="Sealed at rest. Grant the permissions listed below."
						>
							<UInput
								v-model="cfToken"
								type="password"
								placeholder="Cloudflare API Token"
								class="w-full"
							/>
						</UFormField>
						<CloudflareCapabilities
							:token="cfToken"
							:account-id="cfAccountId"
						/>

						<CloudflareEmailOnboarding
							:token="cfToken"
							:account-id="cfAccountId"
						/>

						<CloudflareInboundRouting
							v-if="showInboundRouting"
							:token="cfToken"
							:account-id="cfAccountId"
							:support-email="resolvedSupport"
						/>

						<div class="border-t border-slate-100 pt-4 dark:border-slate-800">
							<div class="flex items-center justify-between gap-3">
								<div>
									<p class="text-sm font-medium">AI-Powered Replies</p>
									<p class="text-xs text-muted">
										Draft replies with Cloudflare AI using this account. Refine it later in
										settings.
									</p>
								</div>
								<USwitch
									v-model="aiEnabled"
									:disabled="!aiAvailable"
								/>
							</div>
							<p
								v-if="!aiAvailable"
								class="mt-2 text-xs text-muted"
							>
								Enter a Cloudflare account + API token above to enable AI replies.
							</p>
							<UFormField
								v-if="aiEnabled"
								label="Model"
								class="mt-3"
								help="Leave blank to use the recommended default."
							>
								<UInput
									v-model="aiModel"
									placeholder="@cf/meta/llama-3.3-70b-instruct-fp8-fast"
									class="w-full"
								/>
							</UFormField>
						</div>
					</div>
				</div>

				<div v-show="step === 3">
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
						<div class="grid gap-4 sm:grid-cols-2">
							<UFormField label="Theme Color">
								<div class="flex items-center gap-3">
									<input
										v-model="themeColor"
										type="color"
										class="h-9 w-14 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
									/>
									<UInput
										v-model="themeColor"
										placeholder="#3b82f6"
										class="flex-1"
									/>
								</div>
							</UFormField>
							<UFormField
								label="Favicon"
								hint="Optional"
								help="An Iconify icon, an image URL, or an uploaded file."
							>
								<UInput
									v-model="favicon"
									placeholder="mdi:rocket-launch"
									class="w-full"
								>
									<template #leading>
										<UIcon
											:name="faviconIsIcon ? favicon : 'mdi:image-outline'"
											:class="faviconIsIcon ? 'text-default' : 'text-dimmed'"
										/>
									</template>
								</UInput>
							</UFormField>
						</div>
						<UFileUpload
							v-model="faviconFile"
							accept=".ico,.svg,image/x-icon,image/png,image/svg+xml"
							class="w-full"
						/>

						<div class="border-t border-slate-100 pt-4 dark:border-slate-800">
							<p class="text-sm font-medium">Role Avatars</p>
							<p class="mb-3 text-xs text-muted">
								Default icon and color shown for each staff role when a member has no avatar of
								their own.
							</p>
							<div class="flex flex-col gap-4">
								<UFormField
									v-for="row in roleRows"
									:key="row.key"
									:label="row.label"
									size="sm"
								>
									<div class="flex items-center gap-3">
										<Avatar
											:icon="roleIcons[row.key] || undefined"
											:role="row.key"
											:color="roleColors[row.key]"
											:name="row.label"
											size="md"
										/>
										<UInput
											v-model="roleIcons[row.key]"
											:placeholder="row.placeholder"
											class="flex-1"
										>
											<template #leading>
												<UIcon
													:name="roleIcons[row.key] || 'mdi:image-outline'"
													:class="roleIcons[row.key] ? 'text-default' : 'text-dimmed'"
												/>
											</template>
										</UInput>
										<USelect
											v-model="roleColors[row.key]"
											:items="colorItems"
											value-key="value"
											class="w-36"
										>
											<template #leading>
												<UChip
													:color="roleColors[row.key]"
													inset
													standalone
												/>
											</template>
										</USelect>
									</div>
								</UFormField>
							</div>
						</div>
					</div>
				</div>

				<div v-show="step === 4">
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
							<span class="text-muted">Inbound Email</span>
							<span class="font-medium">{{ inboundModeLabel }}</span>
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
						color="secondary"
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
import { Role } from '~/shared/types/user';

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
	{ index: 2, label: 'Cloudflare' },
	{ index: 3, label: 'Branding' },
	{ index: 4, label: 'Finish' }
];

const step = ref(0);
const submitting = ref(false);
const error = ref('');

const username = ref('admin');
const email = ref('');
const firstName = ref('');
const lastName = ref('');
const password = ref('');
const confirm = ref('');
const adminAvatar = ref('');

// a bare iconify name becomes an `icon:` sentinel; https urls pass through
const adminAvatarResolved = computed(() => {
	const v = adminAvatar.value.trim();
	if (!v) return '';
	if (v.startsWith('icon:') || v.startsWith('http://') || v.startsWith('https://')) return v;
	return `icon:${v}`;
});

const emailMode = ref<'cloudflare' | 'smtp'>('cloudflare');
const emailModeItems = [
	{ label: 'Cloudflare Email Service', value: 'cloudflare' },
	{ label: 'Custom SMTP', value: 'smtp' }
];
const supportEmail = ref('');
const smtp = ref({ host: '', port: 465, tls: true, user: '', pass: '', from: '' });

const inboundMode = ref<'cloudflare' | 'imap' | 'later'>('cloudflare');
const inboundModeItems = [
	{ label: 'Cloudflare Email Routing', value: 'cloudflare' },
	{ label: 'Custom IMAP/POP3 Mailbox', value: 'imap' },
	{ label: 'Configure Later', value: 'later' }
];
const poll = ref({
	protocol: 'imap' as 'imap' | 'pop3',
	host: '',
	port: 993,
	tls: 'implicit' as 'implicit' | 'starttls' | 'off',
	username: '',
	password: ''
});
const pollProtocolItems = [
	{ label: 'IMAP', value: 'imap' },
	{ label: 'POP3', value: 'pop3' }
];
const pollTlsItems = [
	{ label: 'Implicit', value: 'implicit' },
	{ label: 'STARTTLS', value: 'starttls' },
	{ label: 'Off', value: 'off' }
];
const inboundModeLabel = computed(
	() => inboundModeItems.find((i) => i.value === inboundMode.value)?.label ?? ''
);
// destination address for cf inbound routing; the entered outbound support address
const resolvedSupport = computed(() =>
	(emailMode.value === 'cloudflare' ? supportEmail.value : smtp.value.from).trim()
);

const name = ref('');
const description = ref('');
const themeColor = ref('#3b82f6');
const favicon = ref('');
const faviconFile = ref<File | null>(null);

// a favicon that isn't a url/data uri is treated as an iconify name for the live preview
const faviconIsIcon = computed(() => {
	const v = favicon.value.trim();
	return !!v && !/^(https?:|data:)/i.test(v);
});

type AvatarColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

const colorItems: { label: string; value: AvatarColor; chip: { color: AvatarColor } }[] = [
	{ label: 'Primary', value: 'primary', chip: { color: 'primary' } },
	{ label: 'Secondary', value: 'secondary', chip: { color: 'secondary' } },
	{ label: 'Success', value: 'success', chip: { color: 'success' } },
	{ label: 'Info', value: 'info', chip: { color: 'info' } },
	{ label: 'Warning', value: 'warning', chip: { color: 'warning' } },
	{ label: 'Error', value: 'error', chip: { color: 'error' } },
	{ label: 'Neutral', value: 'neutral', chip: { color: 'neutral' } }
];

const roleRows: { key: Role; label: string; placeholder: string }[] = [
	{ key: Role.Agent, label: 'Agent', placeholder: 'mdi:account' },
	{ key: Role.Manager, label: 'Manager', placeholder: 'mdi:account-tie' },
	{ key: Role.Admin, label: 'Admin', placeholder: 'mdi:shield-account' }
];

const roleIcons = reactive<Record<Role, string>>({
	[Role.Agent]: '',
	[Role.Manager]: '',
	[Role.Admin]: ''
});
const roleColors = reactive<Record<Role, AvatarColor>>({
	[Role.Agent]: 'primary',
	[Role.Manager]: 'primary',
	[Role.Admin]: 'primary'
});

// uploaded favicon -> data url stored in the favicon setting (same convention as settings page)
function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}
watch(faviconFile, async (file) => {
	if (file) favicon.value = await readFileAsDataUrl(file);
});

const cfAccountId = ref('');
const cfToken = ref('');

const aiEnabled = ref(false);
const aiModel = ref('');

// ai needs a cloudflare account + token; no session yet so gate purely on the entered creds
const aiAvailable = computed(() => !!cfAccountId.value.trim() && !!cfToken.value.trim());

// show the cf inbound routing panel only when routing is the chosen inbound + creds are entered
const showInboundRouting = computed(
	() => inboundMode.value === 'cloudflare' && !!cfAccountId.value.trim() && !!cfToken.value.trim()
);
watch(aiAvailable, (ok) => {
	if (!ok) aiEnabled.value = false;
});

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateStep(index: number): string {
	if (index === 0) {
		if (username.value.trim().length < 3) return 'Username must be at least 3 characters';
		if (!emailRe.test(email.value.trim())) return 'Enter a valid email address';
		if (password.value.length < 12) return 'Password must be at least 12 characters';
		if (!/[a-z]/.test(password.value)) return 'Password must contain a lowercase letter';
		if (!/[A-Z]/.test(password.value)) return 'Password must contain an uppercase letter';
		if (!/\d/.test(password.value)) return 'Password must contain a number';
		if (!/[!-/:-@[-`{-~]/.test(password.value))
			return 'Password must contain a special character (e.g. ! ? @ # ^ ~ / = + ; :)';
		if (password.value !== confirm.value) return 'Passwords do not match';
		if (lastName.value.trim() && !firstName.value.trim())
			return 'Enter a first name before adding a last name';
	}
	if (index === 1) {
		if (emailMode.value === 'cloudflare') {
			if (!emailRe.test(supportEmail.value.trim())) return 'Enter a valid support email';
		} else {
			if (!smtp.value.host.trim()) return 'SMTP host is required';
			if (!smtp.value.port || smtp.value.port < 1) return 'Enter a valid SMTP port';
			if (!emailRe.test(smtp.value.from.trim())) return 'Enter a valid from address';
		}
		if (inboundMode.value === 'imap') {
			if (!poll.value.host.trim()) return 'Inbound mailbox host is required';
			if (!poll.value.port || poll.value.port < 1) return 'Enter a valid inbound mailbox port';
			if (!poll.value.username.trim()) return 'Inbound mailbox username is required';
			if (!poll.value.password) return 'Inbound mailbox password is required';
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

// omit blank icons so a role falls back to the built-in default
function buildRoleIcons(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const row of roleRows) {
		const value = roleIcons[row.key].trim();
		if (value) out[row.key] = value;
	}
	return out;
}

function buildRoleColors(): Record<string, AvatarColor> {
	return {
		agent: roleColors[Role.Agent],
		manager: roleColors[Role.Manager],
		admin: roleColors[Role.Admin]
	};
}

function buildEmailSettings() {
	const email: Record<string, any> =
		emailMode.value === 'cloudflare'
			? { transport: 'cloudflare', support_email: supportEmail.value.trim() }
			: {
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
	// custom inbound mailbox; the server seals the poll password out of the email blob
	if (inboundMode.value === 'imap') {
		email.poll = {
			enabled: true,
			protocol: poll.value.protocol,
			host: poll.value.host.trim(),
			port: poll.value.port,
			tls: poll.value.tls,
			username: poll.value.username.trim(),
			password: poll.value.password
		};
	}
	return email;
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
				firstName: firstName.value.trim() || undefined,
				lastName: lastName.value.trim() || undefined,
				adminAvatar: adminAvatarResolved.value || undefined,
				settings: {
					email: buildEmailSettings(),
					name: name.value.trim(),
					description: description.value.trim(),
					themeColor: themeColor.value.trim(),
					favicon: favicon.value.trim(),
					role_colors: buildRoleColors(),
					...(Object.keys(buildRoleIcons()).length ? { role_icons: buildRoleIcons() } : {}),
					...(aiEnabled.value
						? {
								ai: {
									enabled: true,
									...(aiModel.value.trim() ? { model: aiModel.value.trim() } : {})
								}
							}
						: {}),
					...(cfAccountId.value.trim() && cfToken.value.trim()
						? {
								cloudflare: {
									account_id: cfAccountId.value.trim(),
									token: cfToken.value.trim()
								}
							}
						: {})
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
		error.value = extractServerMessage(e, 'Setup failed; please try again.');
	} finally {
		submitting.value = false;
	}
}

useSeoMeta({ title: 'Setup', robots: 'noindex, nofollow' });
</script>
