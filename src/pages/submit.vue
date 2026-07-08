<template>
	<div class="mx-auto w-full max-w-xl px-4 py-12 sm:px-8">
		<div class="mb-8 text-center">
			<UIcon
				name="mdi:ticket-outline"
				class="mx-auto size-12 text-primary"
			/>
			<h1 class="mt-3 text-3xl font-bold">Submit a Request</h1>
			<p class="mt-2 text-muted">
				Tell us what you need help with and we'll get back to you by email.
			</p>
		</div>

		<UCard v-if="result">
			<div class="flex flex-col items-center gap-4 py-4 text-center">
				<UIcon
					name="mdi:check-circle"
					class="size-12 text-success"
				/>
				<h2 class="text-xl font-semibold">Request Received</h2>
				<p class="text-muted">
					Your ticket ID is
					<span class="font-mono font-semibold text-highlighted">#{{ result.ticket_id }}</span
					>. We've sent a confirmation to your email.
				</p>
				<UButton
					:to="statusLink"
					color="primary"
					icon="mdi:radar"
				>
					Track Your Request
				</UButton>
				<UButton
					color="neutral"
					variant="ghost"
					icon="mdi:plus"
					@click="reset"
				>
					Submit Another
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
				label="Email"
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

			<UFormField
				label="Name"
				name="name"
				hint="Optional"
			>
				<UInput
					v-model="state.name"
					autocomplete="name"
					placeholder="Your name"
					class="w-full"
				/>
			</UFormField>

			<UFormField
				label="Subject"
				name="title"
				required
			>
				<UInput
					v-model="state.title"
					placeholder="Brief summary of your request"
					class="w-full"
				/>
			</UFormField>

			<UFormField
				label="Description"
				name="description"
				required
			>
				<UTextarea
					v-model="state.description"
					:rows="6"
					placeholder="Describe your issue or request in detail"
					class="w-full"
				/>
			</UFormField>

			<!-- TODO turnstile widget -->

			<UButton
				type="submit"
				:loading="submitting"
				color="primary"
				icon="mdi:send"
				size="lg"
				class="w-full justify-center"
			>
				Submit Request
			</UButton>
		</UForm>
	</div>
</template>

<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';

definePageMeta({ layout: 'default' });

type SubmitState = {
	email: string;
	name: string;
	title: string;
	description: string;
};

type SubmitResult = { ticket_id: number; status_token: string };

const toast = useToast();

const state = ref<SubmitState>({ email: '', name: '', title: '', description: '' });
const submitting = ref(false);
const result = ref<SubmitResult | null>(null);

const statusLink = computed(() =>
	result.value
		? `/status/${encodeURIComponent(result.value.status_token)}?id=${result.value.ticket_id}`
		: '/'
);

function validate(s: SubmitState): FormError[] {
	const errors: FormError[] = [];
	const email = s.email.trim();
	if (!email) errors.push({ name: 'email', message: 'Email is required' });
	else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		errors.push({ name: 'email', message: 'Enter a valid email address' });
	if (!s.title.trim()) errors.push({ name: 'title', message: 'A subject is required' });
	if (!s.description.trim())
		errors.push({ name: 'description', message: 'A description is required' });
	return errors;
}

async function onSubmit(event: FormSubmitEvent<SubmitState>) {
	submitting.value = true;
	try {
		const body: Record<string, string> = {
			email: event.data.email.trim(),
			title: event.data.title.trim(),
			description: event.data.description.trim()
		};
		const name = event.data.name.trim();
		if (name) body.name = name;

		result.value = await $fetch<SubmitResult>('/api/public/tickets', {
			method: 'POST',
			body
		});
		toast.add({
			title: 'Request Submitted',
			description: 'Check your email for a confirmation.',
			icon: 'mdi:check-circle',
			color: 'success'
		});
	} catch (e: any) {
		toast.add({
			title: 'Submission Failed',
			description: e?.data?.message || e?.message || 'Please try again in a moment.',
			icon: 'mdi:alert-circle',
			color: 'error'
		});
	} finally {
		submitting.value = false;
	}
}

function reset() {
	state.value = { email: '', name: '', title: '', description: '' };
	result.value = null;
}

useSeoMeta({ title: 'Submit a Request' });
</script>
