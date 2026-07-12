<template>
	<div
		class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
	>
		<p class="text-xs font-semibold uppercase tracking-wide text-slate-400">
			People on This Ticket
		</p>

		<div v-if="customerEmail">
			<p class="mb-1 text-xs font-medium text-slate-500">Primary Customer</p>
			<div class="flex items-center gap-2">
				<UIcon
					name="mdi:account-star-outline"
					class="size-4 text-slate-400"
				/>
				<span class="flex-1 truncate text-sm">{{ customerEmail }}</span>
			</div>
		</div>

		<div>
			<p class="mb-1 text-xs font-medium text-slate-500">Participants</p>
			<div
				v-if="participants.length"
				class="divide-y divide-slate-100 dark:divide-slate-800"
			>
				<div
					v-for="email in participants"
					:key="email"
					class="flex items-center gap-2 py-2"
				>
					<UIcon
						name="mdi:email-outline"
						class="size-4 text-slate-400"
					/>
					<span class="flex-1 truncate text-sm">{{ email }}</span>
					<UTooltip
						v-if="canRemove"
						text="Remove Email"
					>
						<UButton
							size="xs"
							color="error"
							variant="ghost"
							icon="mdi:close"
							aria-label="Remove Email"
							:loading="removing === email"
							@click="remove(email)"
						/>
					</UTooltip>
				</div>
			</div>
			<p
				v-else
				class="text-sm text-slate-400"
			>
				No additional people yet.
			</p>
		</div>

		<form
			v-if="canAdd"
			class="flex items-end gap-2"
			@submit.prevent="add"
		>
			<UFormField
				label="Add Email"
				size="sm"
				class="min-w-0 flex-1"
			>
				<UInput
					v-model="draft"
					type="email"
					placeholder="name@example.com"
					class="w-full"
					:disabled="adding"
				/>
			</UFormField>
			<UButton
				type="submit"
				color="primary"
				icon="mdi:plus"
				:loading="adding"
				:disabled="!draft.trim()"
				>Add</UButton
			>
		</form>

		<p class="text-xs text-slate-500">
			People added here can view and reply to this ticket from the portal or the emailed link.
		</p>
	</div>
</template>

<script setup lang="ts">
import { Permission } from '~/shared/types/user';

const props = withDefaults(
	defineProps<{ ticketId: number; customerEmail?: string; participants: string[] }>(),
	{ customerEmail: '', participants: () => [] }
);

const toast = useToast();
const { can, isAdmin } = useAuth();
const { addEmail, removeEmail } = useTicket(() => props.ticketId);

const canAdd = computed(() => isAdmin.value || can(Permission.AddEmail));
const canRemove = computed(() => isAdmin.value || can(Permission.RemoveEmail));

const draft = ref('');
const adding = ref(false);
const removing = ref<string | null>(null);

async function add() {
	const email = draft.value.trim().toLowerCase();
	if (!email) return;
	adding.value = true;
	try {
		await addEmail(email);
		draft.value = '';
		toast.add({
			title: 'Email Added',
			description: `${email} can now view and reply to this ticket.`,
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Add Email',
			description: extractServerMessage(error, 'Could not add the email. Please try again.'),
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
		await removeEmail(email);
		toast.add({
			title: 'Email Removed',
			description: `${email} no longer has access to this ticket.`,
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Remove Email',
			description: extractServerMessage(error, 'Could not remove the email. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		removing.value = null;
	}
}
</script>
