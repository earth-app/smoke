<template>
	<div class="mx-auto flex w-full max-w-md flex-col px-4 py-16 sm:px-8">
		<div class="mb-8 text-center">
			<UIcon
				name="mdi:account-plus"
				class="mx-auto size-12 text-primary"
			/>
			<h1 class="mt-3 text-3xl font-bold">Join the Team</h1>
			<p class="mt-2 text-muted">Set up your support agent account.</p>
		</div>

		<div
			v-if="pending"
			class="space-y-4"
		>
			<USkeleton class="h-10 w-full" />
			<USkeleton class="h-10 w-full" />
			<USkeleton class="h-10 w-full" />
			<USkeleton class="h-10 w-full" />
		</div>

		<UCard v-else-if="!isValid">
			<div class="flex flex-col items-center gap-4 py-6 text-center">
				<UIcon
					:name="invalidIcon"
					class="size-12 text-muted"
				/>
				<h2 class="text-xl font-semibold">{{ invalidTitle }}</h2>
				<p class="max-w-sm text-muted">{{ invalidMessage }}</p>
				<UButton
					to="/login"
					color="primary"
					icon="mdi:login-variant"
				>
					Go to Login
				</UButton>
			</div>
		</UCard>

		<UForm
			v-else
			:state="state"
			:validate="validate"
			class="space-y-4"
			@submit="onSubmit"
		>
			<UFormField
				label="Username"
				name="username"
				hint="3-64 characters"
				required
			>
				<UInput
					v-model="state.username"
					autocomplete="username"
					placeholder="agent"
					class="w-full"
				/>
			</UFormField>

			<UFormField
				label="Email"
				name="email"
				:required="!boundEmail"
			>
				<UInput
					v-model="state.email"
					type="email"
					:disabled="!!boundEmail"
					autocomplete="email"
					placeholder="you@example.com"
					class="w-full"
				/>
			</UFormField>

			<div class="grid gap-4 sm:grid-cols-2">
				<UFormField
					label="First Name"
					name="firstName"
					hint="Optional"
				>
					<UInput
						v-model="state.firstName"
						autocomplete="given-name"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Last Name"
					name="lastName"
					hint="Optional"
				>
					<UInput
						v-model="state.lastName"
						autocomplete="family-name"
						class="w-full"
					/>
				</UFormField>
			</div>

			<UFormField
				label="Password"
				name="password"
				hint="12+ chars, upper, lower, number, symbol"
				required
			>
				<UInput
					v-model="state.password"
					type="password"
					autocomplete="new-password"
					class="w-full"
				/>
				<PasswordStrength
					:password="state.password"
					class="mt-2"
				/>
			</UFormField>

			<UFormField
				label="Confirm Password"
				name="confirm"
				required
			>
				<UInput
					v-model="state.confirm"
					type="password"
					autocomplete="new-password"
					class="w-full"
				/>
			</UFormField>

			<UFormField
				label="Avatar"
				name="avatar"
				hint="Optional"
				help="An Iconify icon, an image URL, or an uploaded image."
			>
				<div class="flex items-center gap-3">
					<img
						v-if="filePreview"
						:src="filePreview"
						class="size-12 rounded-full object-cover"
						:alt="state.username"
					/>
					<Avatar
						v-else
						:avatar="avatarResolved"
						:name="state.username || 'agent'"
						size="lg"
					/>
					<div class="min-w-0 flex-1 space-y-2">
						<UInput
							v-model="state.avatar"
							:disabled="!!file"
							placeholder="mdi:account"
							class="w-full"
						/>
						<UFileUpload
							v-model="file"
							accept="image/*"
							class="w-full"
						/>
					</div>
				</div>
			</UFormField>

			<UButton
				type="submit"
				:loading="submitting"
				color="primary"
				icon="mdi:check"
				size="lg"
				class="w-full justify-center"
			>
				Create Account
			</UButton>
		</UForm>
	</div>
</template>

<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';

definePageMeta({ layout: 'default' });

type InviteState = {
	status: 'valid' | 'expired' | 'exhausted' | 'not_found';
	email: string | null;
	expires: number | null;
	remaining_uses: number;
};

type JoinState = {
	username: string;
	email: string;
	firstName: string;
	lastName: string;
	password: string;
	confirm: string;
	avatar: string;
};

const route = useRoute();
const toast = useToast();
const { setSessionToken } = useAuth();

const token = computed(() => String(route.params.token || ''));

const { data: invite, pending } = await useAsyncData(
	() => `agent-invite:${token.value}`,
	() => $fetch<InviteState>(`/api/agents/invite/${token.value}`),
	{ watch: [token] }
);

const isValid = computed(() => invite.value?.status === 'valid');
const boundEmail = computed(() => (isValid.value ? (invite.value?.email ?? '') : ''));

const invalidTitle = computed(() => {
	switch (invite.value?.status) {
		case 'expired':
			return 'Invite Expired';
		case 'exhausted':
			return 'Invite Already Used';
		default:
			return 'Invite Not Found';
	}
});
const invalidMessage = computed(() => {
	switch (invite.value?.status) {
		case 'expired':
			return 'This invite link has expired. Ask a manager to send you a new one.';
		case 'exhausted':
			return 'This invite link has already been used. Ask a manager to send you a new one.';
		default:
			return "We couldn't find an invite for this link. Double-check the URL or ask for a new invite.";
	}
});
const invalidIcon = computed(() =>
	invite.value?.status === 'expired' ? 'mdi:clock-alert-outline' : 'mdi:link-off'
);

const state = ref<JoinState>({
	username: '',
	email: '',
	firstName: '',
	lastName: '',
	password: '',
	confirm: '',
	avatar: ''
});
const file = ref<File | null>(null);
const filePreview = ref('');
const submitting = ref(false);

// prefill + lock the email when the invite binds one
watch(
	boundEmail,
	(value) => {
		if (value) state.value.email = value;
	},
	{ immediate: true }
);

// a bare iconify name becomes an `icon:` sentinel; https urls pass through
const avatarResolved = computed(() => {
	const v = state.value.avatar.trim();
	if (!v) return '';
	if (v.startsWith('icon:') || v.startsWith('http://') || v.startsWith('https://')) return v;
	return `icon:${v}`;
});

function readFileAsDataUrl(f: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(f);
	});
}

watch(file, async (f) => {
	filePreview.value = f ? await readFileAsDataUrl(f) : '';
});

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(s: JoinState): FormError[] {
	const errors: FormError[] = [];
	if (s.username.trim().length < 3)
		errors.push({ name: 'username', message: 'Username must be at least 3 characters' });
	if (!boundEmail.value && !emailRe.test(s.email.trim()))
		errors.push({ name: 'email', message: 'Enter a valid email address' });
	if (s.password.length < 12)
		errors.push({ name: 'password', message: 'Password must be at least 12 characters' });
	else if (!/[a-z]/.test(s.password))
		errors.push({ name: 'password', message: 'Add a lowercase letter' });
	else if (!/[A-Z]/.test(s.password))
		errors.push({ name: 'password', message: 'Add an uppercase letter' });
	else if (!/\d/.test(s.password)) errors.push({ name: 'password', message: 'Add a number' });
	else if (!/[!-/:-@[-`{-~]/.test(s.password))
		errors.push({ name: 'password', message: 'Add a special character' });
	if (s.confirm !== s.password) errors.push({ name: 'confirm', message: 'Passwords do not match' });
	if (s.lastName.trim() && !s.firstName.trim())
		errors.push({ name: 'firstName', message: 'A first name is required with a last name' });
	return errors;
}

// set the avatar after the account exists, using the freshly minted session token
async function applyAvatar(sessionToken: string) {
	let body: { url: string } | { base64: string } | { icon: string } | null = null;
	if (file.value) {
		body = { base64: await readFileAsDataUrl(file.value) };
	} else {
		const v = state.value.avatar.trim();
		if (!v) return;
		if (v.startsWith('https://')) body = { url: v };
		else if (v.startsWith('data:image/')) body = { base64: v };
		else body = { icon: v.startsWith('icon:') ? v.slice(5) : v };
	}

	try {
		await $fetch('/api/users/current/avatar', {
			method: 'POST',
			body,
			headers: { Authorization: `Bearer ${sessionToken}` }
		});
	} catch (e) {
		// non-fatal; the agent can set their avatar later from their profile
		console.warn('join: failed to set avatar', e);
	}
}

async function onSubmit(event: FormSubmitEvent<JoinState>) {
	submitting.value = true;
	try {
		const response = await $fetch<{ session_token: string }>('/api/agents/join', {
			method: 'POST',
			body: {
				token: token.value,
				username: event.data.username.toLowerCase().trim(),
				password: event.data.password,
				email: boundEmail.value ? undefined : event.data.email.trim(),
				firstName: event.data.firstName.trim() || undefined,
				lastName: event.data.lastName.trim() || undefined
			}
		});

		setSessionToken(response.session_token);
		await applyAvatar(response.session_token);

		toast.add({
			title: 'Welcome Aboard',
			description: 'Your agent account is ready.',
			icon: 'mdi:party-popper',
			color: 'success'
		});
		await navigateTo('/dashboard');
	} catch (e) {
		toast.add({
			title: 'Could Not Complete Signup',
			description: extractServerMessage(e, 'Please check your details and try again.'),
			icon: 'mdi:alert-circle',
			color: 'error'
		});
	} finally {
		submitting.value = false;
	}
}

useSeoMeta({ title: 'Join the Team', robots: 'noindex, nofollow' });
</script>
