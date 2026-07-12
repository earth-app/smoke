<template>
	<div
		class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
	>
		<div class="mb-3">
			<h3 class="text-sm font-semibold">Linked Mailboxes</h3>
			<p class="text-xs text-slate-500">
				Inbound email from these addresses is attributed to this agent.
			</p>
		</div>

		<form
			class="flex flex-wrap items-end gap-2"
			@submit.prevent="add"
		>
			<UFormField
				label="Email"
				size="sm"
				class="min-w-48 flex-1"
			>
				<UInput
					v-model="draft"
					type="email"
					placeholder="agent@example.com"
					class="w-full"
				/>
			</UFormField>
			<UButton
				type="submit"
				color="primary"
				icon="mdi:plus"
				:loading="adding"
				:disabled="!draft.trim()"
				>Link Mailbox</UButton
			>
		</form>

		<div
			v-if="mailboxes.length"
			class="mt-4 divide-y divide-slate-100 dark:divide-slate-800"
		>
			<div
				v-for="email in mailboxes"
				:key="email"
				class="flex items-center gap-2 py-2"
			>
				<UIcon
					name="mdi:email-outline"
					class="size-4 text-slate-400"
				/>
				<span class="flex-1 truncate text-sm">{{ email }}</span>
				<UTooltip text="Unlink Mailbox">
					<UButton
						size="xs"
						color="error"
						variant="ghost"
						icon="mdi:link-off"
						aria-label="Unlink Mailbox"
						:loading="removing === email"
						@click="remove(email)"
					/>
				</UTooltip>
			</div>
		</div>
		<p
			v-else
			class="mt-4 text-sm text-slate-400"
		>
			No mailboxes linked yet.
		</p>
	</div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ userId: string; initial?: string[] }>(), {
	initial: () => []
});

const toast = useToast();
const { sessionToken } = useAuth();

const mailboxes = ref<string[]>([...props.initial]);
const draft = ref('');
const adding = ref(false);
const removing = ref<string | null>(null);

watch(
	() => props.initial,
	(value) => {
		mailboxes.value = [...(value || [])];
	}
);

function authHeaders(): Record<string, string> {
	return sessionToken.value ? { Authorization: `Bearer ${sessionToken.value}` } : {};
}

async function add() {
	const email = draft.value.trim().toLowerCase();
	if (!email) return;
	if (mailboxes.value.includes(email)) {
		draft.value = '';
		return;
	}
	adding.value = true;
	try {
		await $fetch(`/api/users/${encodeURIComponent(props.userId)}/emails`, {
			method: 'POST',
			body: { email },
			credentials: 'include',
			headers: authHeaders()
		});
		mailboxes.value.push(email);
		draft.value = '';
		toast.add({
			title: 'Mailbox Linked',
			description: `${email} is now linked.`,
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Link Mailbox',
			description: extractServerMessage(error, 'Could not link the mailbox. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		adding.value = false;
	}
}

async function remove(email: string) {
	removing.value = email;
	try {
		await $fetch(`/api/users/${encodeURIComponent(props.userId)}/emails`, {
			method: 'DELETE',
			body: { email },
			credentials: 'include',
			headers: authHeaders()
		});
		mailboxes.value = mailboxes.value.filter((m) => m !== email);
		toast.add({
			title: 'Mailbox Unlinked',
			description: `${email} was removed.`,
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Unlink Mailbox',
			description: extractServerMessage(error, 'Could not remove the mailbox. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		removing.value = null;
	}
}
</script>
