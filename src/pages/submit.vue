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
					>.
					{{
						result.emailed
							? "We've sent a confirmation to your email."
							: 'Save the tracking link below to check back on this request.'
					}}
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
				hint="Optional"
				help="Add your email to also get updates by reply. Leave blank to track it here only."
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

			<TurnstileWidget
				v-if="turnstileActive"
				@received-token="turnstileToken = $event"
			/>

			<UButton
				type="submit"
				:loading="submitting"
				:disabled="turnstileActive && !turnstileToken"
				color="primary"
				icon="mdi:send"
				size="lg"
				class="w-full justify-center"
			>
				Submit Request
			</UButton>
		</UForm>

		<TicketMyRequests class="mt-8" />
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

type SubmitResult = { ticket_id: number; status_token: string; emailed: boolean };

const toast = useToast();
const { remember } = useMyRequests();

const config = useRuntimeConfig();
const turnstileActive = computed(() => !!config.public.turnstile?.siteKey);
const turnstileToken = ref('');

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
	// email is optional; only validate the format when one was entered
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		errors.push({ name: 'email', message: 'Enter a valid email address' });
	if (!s.title.trim()) errors.push({ name: 'title', message: 'A subject is required' });
	if (!s.description.trim())
		errors.push({ name: 'description', message: 'A description is required' });
	return errors;
}

async function onSubmit(event: FormSubmitEvent<SubmitState>) {
	submitting.value = true;
	try {
		const email = event.data.email.trim();
		const title = event.data.title.trim();
		const body: Record<string, string> = { title, description: event.data.description.trim() };
		if (email) body.email = email;
		const name = event.data.name.trim();
		if (name) body.name = name;
		if (turnstileActive.value) body.turnstile = turnstileToken.value;

		const response = await $fetch<{ ticket_id: number; status_token: string }>(
			'/api/public/tickets',
			{ method: 'POST', body }
		);
		result.value = { ...response, emailed: !!email };
		remember({
			id: response.ticket_id,
			token: response.status_token,
			title,
			created_at: Date.now()
		});
		toast.add({
			title: 'Request Submitted',
			description: email
				? 'Check your email for a confirmation.'
				: 'Save your tracking link to check back on this request.',
			icon: 'mdi:check-circle',
			color: 'success'
		});
	} catch (e: any) {
		toast.add({
			title: 'Submission Failed',
			description: extractServerMessage(e, 'Please try again in a moment.'),
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

useSeoMeta({
	title: 'Submit a Request',
	description: 'Open a new support request and get help fast.',
	ogTitle: 'Submit a Request',
	ogDescription: 'Open a new support request and get help fast.',
	twitterCard: 'summary'
});
useSchemaOrg([
	defineWebPage({ '@type': ['WebPage', 'ContactPage'] }),
	defineBreadcrumb({
		itemListElement: [
			{ name: 'Home', item: '/' },
			{ name: 'Submit a Request', item: '/submit' }
		]
	})
]);
</script>
