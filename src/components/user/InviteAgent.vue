<template>
	<UModal
		v-model:open="open"
		title="Invite Agent"
	>
		<template #content>
			<UCard>
				<template #header>
					<div>
						<h2 class="text-lg font-semibold">Invite Agent</h2>
						<p class="text-sm text-muted">
							Generate a one-time link for a new support agent to set up their account.
						</p>
					</div>
				</template>

				<div v-if="!result">
					<UForm
						:state="state"
						:validate="validate"
						class="space-y-4"
						@submit="onSubmit"
					>
						<UFormField
							label="Email"
							name="email"
							hint="Optional"
							help="If set, the link is locked to this address and emailed to them."
						>
							<UInput
								v-model="state.email"
								type="email"
								placeholder="new.agent@example.com"
								class="w-full"
							/>
						</UFormField>

						<div class="grid gap-4 sm:grid-cols-2">
							<UFormField
								label="Expires In"
								name="ttlMinutes"
							>
								<USelect
									v-model="state.ttlMinutes"
									:items="ttlItems"
									class="w-full"
								/>
							</UFormField>
							<UFormField
								label="Max Uses"
								name="maxUses"
							>
								<UInputNumber
									v-model="state.maxUses"
									:min="1"
									:max="100"
									class="w-full"
								/>
							</UFormField>
						</div>

						<div class="flex justify-end gap-2">
							<UButton
								color="neutral"
								variant="ghost"
								@click="
									() => {
										open = false;
									}
								"
							>
								Cancel
							</UButton>
							<UButton
								type="submit"
								color="primary"
								icon="mdi:link-plus"
								:loading="submitting"
							>
								Create Invite
							</UButton>
						</div>
					</UForm>
				</div>

				<div
					v-else
					class="space-y-4"
				>
					<UAlert
						color="success"
						variant="subtle"
						icon="mdi:check-circle"
						:title="result.emailed ? `Invite Emailed to ${result.email}` : 'Invite Created'"
						:description="`Share this link. It expires ${expiresLabel} and works ${usesLabel}.`"
					/>

					<UFormField label="Invite Link">
						<div class="flex gap-2">
							<UInput
								:model-value="result.url"
								readonly
								class="flex-1"
							/>
							<UButton
								color="neutral"
								variant="subtle"
								:icon="copied ? 'mdi:check' : 'mdi:content-copy'"
								:aria-label="'Copy Invite Link'"
								@click="copyLink"
							/>
						</div>
					</UFormField>

					<div class="flex justify-end gap-2">
						<UButton
							color="neutral"
							variant="ghost"
							icon="mdi:plus"
							@click="reset"
						>
							Create Another
						</UButton>
						<UButton
							color="primary"
							icon="mdi:check"
							@click="
								() => {
									open = false;
								}
							"
						>
							Done
						</UButton>
					</div>
				</div>
			</UCard>
		</template>
	</UModal>
</template>

<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui';

const open = defineModel<boolean>('open', { default: false });

const toast = useToast();
const { sessionToken } = useAuth();

type InviteForm = { email: string; ttlMinutes: number; maxUses: number };
type InviteResult = {
	url: string;
	email: string | null;
	expires: number;
	max_uses: number;
	emailed: boolean;
};

const ttlItems = [
	{ label: '15 Minutes', value: 15 },
	{ label: '30 Minutes', value: 30 },
	{ label: '1 Hour', value: 60 },
	{ label: '24 Hours', value: 1440 }
];

const state = ref<InviteForm>({ email: '', ttlMinutes: 30, maxUses: 1 });
const submitting = ref(false);
const result = ref<InviteResult | null>(null);
const copied = ref(false);

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(s: InviteForm): FormError[] {
	const errors: FormError[] = [];
	if (s.email.trim() && !emailRe.test(s.email.trim()))
		errors.push({ name: 'email', message: 'Enter a valid email address' });
	if (s.maxUses < 1 || s.maxUses > 100)
		errors.push({ name: 'maxUses', message: 'Max uses must be between 1 and 100' });
	return errors;
}

const expiresLabel = computed(() => {
	if (!result.value) return '';
	const minutes = Math.max(1, Math.round((result.value.expires - Date.now()) / 60000));
	if (minutes >= 60) {
		const hours = Math.round(minutes / 60);
		return hours === 1 ? 'in 1 hour' : `in ${hours} hours`;
	}
	return `in ${minutes} minutes`;
});

const usesLabel = computed(() => {
	const uses = result.value?.max_uses ?? 1;
	return uses === 1 ? 'once' : `up to ${uses} times`;
});

function reset() {
	result.value = null;
	copied.value = false;
	state.value = { email: '', ttlMinutes: 30, maxUses: 1 };
}

async function onSubmit(event: FormSubmitEvent<InviteForm>) {
	submitting.value = true;
	try {
		const response = await $fetch<InviteResult>('/api/agents/invite', {
			method: 'POST',
			headers: { Authorization: `Bearer ${sessionToken.value}` },
			body: {
				email: event.data.email.trim() || undefined,
				ttlMinutes: event.data.ttlMinutes,
				maxUses: event.data.maxUses
			}
		});
		result.value = response;
		if (response.emailed)
			toast.add({
				title: 'Invite Emailed',
				description: `Sent to ${response.email}.`,
				icon: 'mdi:email-check-outline',
				color: 'success'
			});
	} catch (e) {
		toast.add({
			title: 'Could Not Create Invite',
			description: extractServerMessage(e, 'Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error'
		});
	} finally {
		submitting.value = false;
	}
}

async function copyLink() {
	if (!result.value) return;
	try {
		await navigator.clipboard.writeText(result.value.url);
		copied.value = true;
		setTimeout(() => (copied.value = false), 2000);
	} catch {
		toast.add({
			title: 'Copy Failed',
			description: 'Select the link and copy it manually.',
			icon: 'mdi:alert-circle',
			color: 'error'
		});
	}
}

// clear the previous result whenever the modal is reopened
watch(open, (isOpen) => {
	if (isOpen) reset();
});
</script>
