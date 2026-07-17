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
				<Avatar
					:avatar="customer.avatar_url"
					:name="customer.name || customer.email"
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
			<Transition
				enter-active-class="transition-opacity"
				leave-active-class="transition-opacity"
				enter-from-class="opacity-0"
				leave-to-class="opacity-0"
			>
				<div
					v-if="saving"
					class="flex items-center gap-1.5 text-xs text-slate-400"
				>
					<UIcon
						name="mdi:loading"
						class="animate-spin"
					/>
					<span>Saving...</span>
				</div>
			</Transition>

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
				<TicketLabelPicker
					:model-value="selectedLabelIds"
					:labels="labels"
					:disabled="!canChangeLabels"
					@update:model-value="(v) => emitPatch({ labels: v })"
					@labels-changed="() => emit('labelsChanged')"
				/>
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
				>
					<template #item-leading="{ item }">
						<Avatar
							:avatar="item.user.avatar_url"
							:id="item.user.id"
							:role="item.user.role"
							:name="item.user.username"
							size="2xs"
						/>
					</template>
				</USelectMenu>
			</UFormField>

			<UFormField
				v-if="canTogglePrivate"
				label="Visibility"
				size="sm"
			>
				<USelect
					:model-value="ticket.visibility"
					:items="visibilityItems"
					class="w-full"
					@update:model-value="(v) => emitPatch({ visibility: v as TicketVisibility })"
				/>
			</UFormField>

			<UFormField
				label="Projects"
				size="sm"
			>
				<TicketProjectSelect
					:model-value="ticket.project_ids ?? []"
					:disabled="!canManage"
					@update:model-value="(v) => emitPatch({ project_ids: v as number[] })"
				/>
			</UFormField>

			<UFormField
				label="Icon"
				size="sm"
			>
				<TicketIconSelect
					:model-value="ticket.icon"
					:color="ticket.color"
					:disabled="!canManage"
					@update:model-value="(v) => emitPatch({ icon: v })"
				/>
			</UFormField>

			<div class="grid grid-cols-2 gap-3">
				<UFormField
					label="Color"
					size="sm"
				>
					<input
						type="color"
						:value="ticket.color || '#64748b'"
						:disabled="!canManage"
						class="h-9 w-full cursor-pointer rounded border border-slate-200 dark:border-slate-700"
						@change="(e) => emitPatch({ color: (e.target as HTMLInputElement).value })"
					/>
				</UFormField>
				<UFormField
					label="Deadline"
					size="sm"
				>
					<UInput
						type="date"
						:model-value="deadlineValue"
						:disabled="!canManage"
						class="w-full"
						@update:model-value="(v) => emitPatch({ deadline: v ? String(v) : null })"
					/>
				</UFormField>
			</div>
		</div>

		<TicketParticipants
			:ticket-id="ticket.id"
			:customer-email="customer?.email"
			:participants="ticket.participants ?? []"
		/>

		<div
			v-if="hasCustomFields"
			class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
		>
			<p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Custom Fields</p>
			<TicketCustomFields
				:model-value="ticket.custom_fields || {}"
				:disabled="!canManage"
				@update:model-value="(v) => emitPatch({ custom_fields: v as Record<string, string> })"
			/>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { Ticket, TicketPatchInput } from '~/shared/types/ticket';
import { TicketPriority, TicketStatus, TicketVisibility } from '~/shared/types/ticket';
import type { Customer, Label, User } from '~/shared/types/user';
import { Permission } from '~/shared/types/user';

const props = defineProps<{
	ticket: Ticket;
	customer?: Customer | null;
	labels: Label[];
	users: User[];
	saving?: boolean;
}>();

const emit = defineEmits<{ patch: [body: TicketPatchInput]; labelsChanged: [] }>();

const { can, isAdmin } = useAuth();

const canManage = computed(() => isAdmin.value || can(Permission.ManageTicket));
const canChangeLabels = computed(() => isAdmin.value || can(Permission.ChangeLabels));
const canTogglePrivate = computed(() => isAdmin.value || can(Permission.TogglePrivate));

const { fields: customFieldDefs } = useCustomFields();
const hasCustomFields = computed(() => customFieldDefs.value.length > 0);

// enum dropdowns carry a leading icon via the shared display maps
const statusItems = statusSelectItems();
const priorityItems = prioritySelectItems();
const visibilityItems = visibilitySelectItems();

// a date input wants YYYY-MM-DD; the ticket stores an iso timestamp
const deadlineValue = computed(() =>
	props.ticket.deadline ? new Date(props.ticket.deadline).toISOString().slice(0, 10) : ''
);

const selectedLabelIds = computed(() => props.ticket.labels || []);

const assigneeItems = computed(() =>
	props.users.map((user) => ({ label: user.name || user.username, value: user.id, user }))
);
const selectedAssigneeIds = computed(() => props.ticket.assignees.map((a) => a.id));

function emitPatch(body: TicketPatchInput) {
	emit('patch', body);
}
</script>
