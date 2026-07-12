<template>
	<div class="mx-auto flex w-full max-w-md flex-col px-4 py-16 sm:px-8">
		<div
			v-if="authResolving"
			class="space-y-4"
		>
			<div class="mb-8 flex flex-col items-center gap-3">
				<Skeleton
					variant="avatar"
					width="3rem"
					height="3rem"
				/>
				<Skeleton
					variant="line"
					width="12rem"
					height="1.75rem"
				/>
				<Skeleton
					variant="line"
					width="16rem"
					height="1rem"
				/>
			</div>
			<Skeleton
				variant="line"
				width="7rem"
				height="0.875rem"
			/>
			<Skeleton
				variant="rect"
				height="2.5rem"
				rounded="rounded-md"
			/>
			<Skeleton
				variant="rect"
				height="2.75rem"
				rounded="rounded-md"
			/>
		</div>

		<AppPortalStaffNotice v-else-if="isStaff" />

		<template v-else>
			<div class="mb-8 text-center">
				<UIcon
					name="mdi:account-circle-outline"
					class="mx-auto size-12 text-primary"
				/>
				<h1 class="mt-3 text-3xl font-bold">Customer Portal</h1>
				<p class="mt-2 text-muted">Verify your email to manage all of your support requests.</p>
			</div>

			<UForm
				v-if="step === 'email'"
				:state="state"
				:validate="validateEmail"
				class="space-y-4"
				@submit="onRequestCode"
			>
				<UFormField
					label="Email Address"
					name="email"
					required
				>
					<UInput
						v-model="state.email"
						type="email"
						autocomplete="email"
						placeholder="you@example.com"
						class="w-full"
					/>
				</UFormField>

				<TurnstileWidget
					v-if="turnstileActive"
					@received-token="turnstileToken = $event"
				/>

				<UButton
					type="submit"
					:loading="submitting"
					:disabled="turnstileActive && !turnstileToken"
					color="primary"
					icon="mdi:email-fast-outline"
					size="lg"
					class="w-full justify-center"
				>
					Send Verification Code
				</UButton>
			</UForm>

			<UForm
				v-else
				:state="state"
				:validate="validateCode"
				class="space-y-4"
				@submit="onVerifyCode"
			>
				<p class="text-sm text-muted">
					We sent a 6-digit code to
					<span class="font-medium text-highlighted">{{ state.email }}</span> if an account exists.
					Enter it below.
				</p>

				<UFormField
					label="Verification Code"
					name="code"
					required
				>
					<UInput
						v-model="state.code"
						inputmode="numeric"
						autocomplete="one-time-code"
						maxlength="6"
						placeholder="123456"
						class="w-full"
					/>
				</UFormField>

				<UButton
					type="submit"
					:loading="submitting"
					color="primary"
					icon="mdi:login-variant"
					size="lg"
					class="w-full justify-center"
				>
					Verify and Continue
				</UButton>

				<div class="flex items-center justify-between text-sm">
					<UButton
						variant="link"
						color="neutral"
						class="px-0"
						:disabled="submitting"
						@click="resetToEmail"
					>
						Use a Different Email
					</UButton>
					<UButton
						variant="link"
						color="primary"
						class="px-0"
						:loading="resending"
						@click="onResend"
					>
						Resend Code
					</UButton>
				</div>
			</UForm>
		</template>
	</div>
</template>

<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';

definePageMeta({ layout: 'default' });

type PortalLoginState = { email: string; code: string };

const toast = useToast();
const route = useRoute();
const { customer, requestOtp, verifyOtp, fetchCustomer } = useCustomerAuth();
const { user, sessionToken, isAuthenticated } = useAuth();

const config = useRuntimeConfig();
const turnstileActive = computed(() => !!config.public.turnstile?.siteKey);
const turnstileToken = ref('');

// staff signed in via cookie should not see the customer login; skeleton while auth hydrates
const authResolving = computed(
	() => user.value === undefined || (!!sessionToken.value && !user.value)
);
const isStaff = computed(() => isAuthenticated.value);

// an already-signed-in customer shouldn't see the login form; send them to their requests
watch(
	customer,
	(c) => {
		if (!c || isStaff.value) return;
		const redirect = route.query.redirect;
		const target = typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/portal';
		navigateTo(target);
	},
	{ immediate: true }
);

const state = ref<PortalLoginState>({ email: '', code: '' });
const step = ref<'email' | 'code'>('email');
const submitting = ref(false);
const resending = ref(false);

function validateEmail(s: PortalLoginState): FormError[] {
	const errors: FormError[] = [];
	if (!s.email.trim()) errors.push({ name: 'email', message: 'Enter your email' });
	return errors;
}

function validateCode(s: PortalLoginState): FormError[] {
	const errors: FormError[] = [];
	if (!/^\d{6}$/.test(s.code.trim()))
		errors.push({ name: 'code', message: 'Enter the 6-digit code' });
	return errors;
}

async function onRequestCode(_event: FormSubmitEvent<PortalLoginState>) {
	submitting.value = true;
	try {
		const outcome = await requestOtp(
			state.value.email.trim(),
			turnstileActive.value ? turnstileToken.value : undefined
		);
		if (!outcome.success) {
			toast.add({
				title: 'Could Not Send Code',
				description: outcome.message,
				icon: 'mdi:alert-circle',
				color: 'error'
			});
			return;
		}
		step.value = 'code';
		toast.add({
			title: 'Check Your Email',
			description: 'If an account exists, a verification code is on its way.',
			icon: 'mdi:email-check-outline',
			color: 'success',
			duration: 4000
		});
	} finally {
		submitting.value = false;
	}
}

async function onVerifyCode(_event: FormSubmitEvent<PortalLoginState>) {
	submitting.value = true;
	try {
		const outcome = await verifyOtp(state.value.email.trim(), state.value.code.trim());
		if (!outcome.success) {
			toast.add({
				title: 'Verification Failed',
				description: outcome.message,
				icon: 'mdi:alert-circle',
				color: 'error'
			});
			return;
		}
		await fetchCustomer(true);
		const redirect = route.query.redirect;
		const target = typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/portal';
		await navigateTo(target);
	} finally {
		submitting.value = false;
	}
}

async function onResend() {
	resending.value = true;
	try {
		await requestOtp(
			state.value.email.trim(),
			turnstileActive.value ? turnstileToken.value : undefined
		);
		toast.add({
			title: 'Code Resent',
			description: 'Check your inbox for a new verification code.',
			icon: 'mdi:email-sync-outline',
			color: 'success',
			duration: 3000
		});
	} finally {
		resending.value = false;
	}
}

function resetToEmail() {
	step.value = 'email';
	state.value.code = '';
}

useSeoMeta({ title: 'Customer Portal', robots: 'noindex, nofollow' });
</script>
