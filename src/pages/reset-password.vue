<template>
	<div class="mx-auto flex w-full max-w-md flex-col px-4 py-16 sm:px-8">
		<div class="mb-8 text-center">
			<UIcon
				name="mdi:lock-reset"
				class="mx-auto size-12 text-primary"
			/>
			<h1 class="mt-3 text-3xl font-bold">Reset Password</h1>
			<p class="mt-2 text-muted">
				{{
					step === 'request'
						? 'Enter your email and we will send you a reset code.'
						: 'Enter the code we emailed you and choose a new password.'
				}}
			</p>
		</div>

		<UForm
			v-if="step === 'request'"
			:state="requestState"
			:validate="validateRequest"
			class="space-y-4"
			@submit="onRequest"
		>
			<UFormField
				label="Email"
				name="email"
				required
			>
				<UInput
					v-model="requestState.email"
					type="email"
					autocomplete="email"
					placeholder="you@example.com"
					class="w-full"
				/>
			</UFormField>

			<UButton
				type="submit"
				:loading="submitting"
				color="primary"
				icon="mdi:email-fast-outline"
				size="lg"
				class="w-full justify-center"
			>
				Send Reset Code
			</UButton>

			<div class="text-center text-sm">
				<ULink
					to="/login"
					class="text-muted hover:text-default"
				>
					Back to Login
				</ULink>
			</div>
		</UForm>

		<UForm
			v-else
			:state="verifyState"
			:validate="validateVerify"
			class="space-y-4"
			@submit="onVerify"
		>
			<UFormField
				label="Reset Code"
				name="code"
				hint="8 digits"
				required
			>
				<UInput
					v-model="verifyState.code"
					inputmode="numeric"
					autocomplete="one-time-code"
					placeholder="12345678"
					class="w-full"
				/>
			</UFormField>

			<UFormField
				label="New Password"
				name="password"
				hint="12+ chars, upper, lower, number, symbol"
				required
			>
				<UInput
					v-model="verifyState.password"
					type="password"
					autocomplete="new-password"
					class="w-full"
				/>
				<PasswordStrength
					:password="verifyState.password"
					class="mt-2"
				/>
			</UFormField>

			<UFormField
				label="Confirm Password"
				name="confirm"
				required
			>
				<UInput
					v-model="verifyState.confirm"
					type="password"
					autocomplete="new-password"
					class="w-full"
				/>
			</UFormField>

			<UButton
				type="submit"
				:loading="submitting"
				color="primary"
				icon="mdi:check"
				size="lg"
				class="w-full justify-center"
			>
				Set New Password
			</UButton>

			<div class="flex items-center justify-between text-sm">
				<button
					type="button"
					class="text-muted hover:text-default"
					@click="step = 'request'"
				>
					Use a Different Email
				</button>
				<ULink
					to="/login"
					class="text-muted hover:text-default"
				>
					Back to Login
				</ULink>
			</div>
		</UForm>
	</div>
</template>

<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';

definePageMeta({ layout: 'default' });

type RequestState = { email: string };
type VerifyState = { code: string; password: string; confirm: string };

const toast = useToast();

const step = ref<'request' | 'verify'>('request');
const submitting = ref(false);

const requestState = ref<RequestState>({ email: '' });
const verifyState = ref<VerifyState>({ code: '', password: '', confirm: '' });

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRequest(s: RequestState): FormError[] {
	const errors: FormError[] = [];
	if (!emailRe.test(s.email.trim()))
		errors.push({ name: 'email', message: 'Enter a valid email address' });
	return errors;
}

function validateVerify(s: VerifyState): FormError[] {
	const errors: FormError[] = [];
	if (!/^\d{8}$/.test(s.code.trim()))
		errors.push({ name: 'code', message: 'Enter the 8-digit code' });
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
	return errors;
}

async function onRequest(event: FormSubmitEvent<RequestState>) {
	submitting.value = true;
	try {
		await $fetch('/api/agents/forgot-password', {
			method: 'POST',
			body: { email: event.data.email.trim() }
		});
		// always advance; the response is deliberately identical for unknown emails
		step.value = 'verify';
		toast.add({
			title: 'Check Your Email',
			description: 'If an account exists for that address, a reset code is on its way.',
			icon: 'mdi:email-check-outline',
			color: 'info'
		});
	} catch (e) {
		toast.add({
			title: 'Could Not Send Code',
			description: extractServerMessage(e, 'Please try again in a moment.'),
			icon: 'mdi:alert-circle',
			color: 'error'
		});
	} finally {
		submitting.value = false;
	}
}

async function onVerify(event: FormSubmitEvent<VerifyState>) {
	submitting.value = true;
	try {
		await $fetch('/api/agents/reset-password', {
			method: 'POST',
			body: {
				email: requestState.value.email.trim(),
				code: event.data.code.trim(),
				password: event.data.password
			}
		});
		toast.add({
			title: 'Password Updated',
			description: 'Sign in with your new password.',
			icon: 'mdi:check-circle',
			color: 'success'
		});
		await navigateTo('/login');
	} catch (e) {
		toast.add({
			title: 'Could Not Reset Password',
			description: extractServerMessage(e, 'Check the code and try again.'),
			icon: 'mdi:alert-circle',
			color: 'error'
		});
	} finally {
		submitting.value = false;
	}
}

useSeoMeta({ title: 'Reset Password', robots: 'noindex, nofollow' });
</script>
