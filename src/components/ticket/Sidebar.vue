<template>
	<div class="flex flex-col gap-5">
		<div
			v-if="customer"
			class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
		>
			<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Customer</p>
			<NuxtLink
				:to="`/dashboard/customers/${customer.id}`"
				class="flex items-center gap-3 hover:opacity-80"
			>
				<UAvatar
					:src="customer.avatar_url"
					:alt="customer.name || customer.email"
					size="sm"
				/>
				<div class="min-w-0">
					<p class="truncate text-sm font-medium">{{ customer.name || 'Customer' }}</p>
					<p class="truncate text-xs text-slate-500">{{ customer.email }}</p>
				</div>
			</NuxtLink>
		</div>

		<div
			class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
		>
			<UFormField
				label="Status"
				size="sm"
			>
				<USelect
					:model-value="ticket.status"
					:items="statusItems"
					:disabled="!canManage"
					class="w-full"
					@update:model-value="(v) => emitPatch({ status: v as TicketStatus })"
				/>
			</UFormField>

			<UFormField
				label="Priority"
				size="sm"
			>
				<USelect
					:model-value="ticket.priority"
					:items="priorityItems"
					:disabled="!canManage"
					class="w-full"
					@update:model-value="(v) => emitPatch({ priority: v as TicketPriority })"
				/>
			</UFormField>

			<UFormField
				label="Labels"
				size="sm"
			>
				<USelectMenu
					:model-value="selectedLabelIds"
					:items="labelItems"
					value-key="value"
					multiple
					:disabled="!canChangeLabels"
					placeholder="Add labels"
					class="w-full"
					@update:model-value="(v) => emitPatch({ labels: v as number[] })"
				/>
				<div
					v-if="ticketLabels.length"
					class="mt-2 flex flex-wrap gap-1"
				>
					<LabelBadge
						v-for="label in ticketLabels"
						:key="label.id"
						:label="label"
					/>
				</div>
			</UFormField>

			<UFormField
				label="Assignees"
				size="sm"
			>
				<USelectMenu
					:model-value="selectedAssigneeIds"
					:items="assigneeItems"
					value-key="value"
					multiple
					:disabled="!canManage"
					placeholder="Assign teammates"
					class="w-full"
					@update:model-value="(v) => emitPatch({ assignee_ids: v as string[] })"
				/>
			</UFormField>

			<div
				v-if="canTogglePrivate"
				class="flex items-center justify-between"
			>
				<div>
					<p class="text-sm font-medium">Private</p>
					<p class="text-xs text-slate-500">Hide this ticket from customers.</p>
				</div>
				<USwitch
					:model-value="ticket.private"
					@update:model-value="(v) => emitPatch({ private: Boolean(v) })"
				/>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { Ticket, TicketPatchInput } from '~/shared/types/ticket';
import { TicketPriority, TicketStatus } from '~/shared/types/ticket';
import type { Customer, Label, User } from '~/shared/types/user';
import { Permission } from '~/shared/types/user';

const props = defineProps<{
	ticket: Ticket;
	customer?: Customer | null;
	labels: Label[];
	users: User[];
}>();

const emit = defineEmits<{ patch: [body: TicketPatchInput] }>();

const { can, isAdmin } = useAuth();

const canManage = computed(() => isAdmin.value || can(Permission.ManageTicket));
const canChangeLabels = computed(() => isAdmin.value || can(Permission.ChangeLabels));
const canTogglePrivate = computed(() => isAdmin.value || can(Permission.TogglePrivate));

const statusItems = Object.values(TicketStatus).map((value) => ({
	label: statusLabel(value),
	value
}));

const priorityItems = Object.values(TicketPriority).map((value) => ({
	label: value.charAt(0).toUpperCase() + value.slice(1),
	value
}));

const labelItems = computed(() =>
	props.labels.map((label) => ({ label: label.name, value: label.id }))
);
const selectedLabelIds = computed(() => props.ticket.labels || []);
const ticketLabels = computed<Label[]>(() =>
	selectedLabelIds.value
		.map((id) => props.labels.find((l) => l.id === id))
		.filter((l): l is Label => !!l)
);

const assigneeItems = computed(() =>
	props.users.map((user) => ({ label: user.name || user.username, value: user.id }))
);
const selectedAssigneeIds = computed(() => props.ticket.assignees.map((a) => a.id));

function emitPatch(body: TicketPatchInput) {
	emit('patch', body);
}

function statusLabel(value: TicketStatus): string {
	return value
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}
</script>
