<template>
	<div class="mx-auto flex w-full max-w-md flex-col px-4 py-16 sm:px-8">
		<div class="mb-8 text-center">
			<UIcon
				name="mdi:shield-account"
				class="mx-auto size-12 text-primary"
			/>
			<h1 class="mt-3 text-3xl font-bold">Staff Login</h1>
			<p class="mt-2 text-muted">Sign in to manage support requests.</p>
		</div>

		<UForm
			:state="state"
			:validate="validate"
			class="space-y-4"
			@submit="onSubmit"
		>
			<UFormField
				label="Username or Email"
				name="usernameOrEmail"
				required
			>
				<UInput
					v-model="state.usernameOrEmail"
					autocomplete="username"
					placeholder="admin"
					class="w-full"
				/>
			</UFormField>

			<UFormField
				label="Password"
				name="password"
				required
			>
				<UInput
					v-model="state.password"
					type="password"
					autocomplete="current-password"
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
				Sign In
			</UButton>
		</UForm>
	</div>
</template>

<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';

definePageMeta({ layout: 'default' });

type LoginState = { usernameOrEmail: string; password: string };

const toast = useToast();
const route = useRoute();
const { login } = useAuth();

const state = ref<LoginState>({ usernameOrEmail: '', password: '' });
const submitting = ref(false);

function validate(s: LoginState): FormError[] {
	const errors: FormError[] = [];
	if (!s.usernameOrEmail.trim())
		errors.push({ name: 'usernameOrEmail', message: 'Enter your username or email' });
	if (!s.password) errors.push({ name: 'password', message: 'Enter your password' });
	return errors;
}

async function onSubmit(event: FormSubmitEvent<LoginState>) {
	submitting.value = true;
	try {
		const outcome = await login(event.data.usernameOrEmail.trim(), event.data.password);
		if (!outcome.success) {
			toast.add({
				title: 'Login Failed',
				description: outcome.message || 'Invalid credentials.',
				icon: 'mdi:alert-circle',
				color: 'error'
			});
			return;
		}
		const redirect = route.query.redirect;
		const target =
			typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/dashboard';
		await navigateTo(target);
	} finally {
		submitting.value = false;
	}
}

useSeoMeta({ title: 'Staff Login' });
</script>
