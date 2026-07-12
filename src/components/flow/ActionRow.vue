<template>
	<div class="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
		<div class="flex flex-wrap items-end gap-2">
			<UFormField
				label="Action"
				size="sm"
				class="min-w-40 flex-1"
			>
				<USelect
					v-model="model.type"
					:items="actionItems"
					class="w-full"
					@update:model-value="onTypeChange"
				/>
			</UFormField>

			<UFormField
				v-if="scalarMode"
				label="Value"
				size="sm"
				class="min-w-40 flex-2"
			>
				<USelect
					v-if="valueMode === 'priority'"
					v-model="model.value"
					:items="priorityItems"
					class="w-full"
				/>
				<USelect
					v-else-if="valueMode === 'status'"
					v-model="model.value"
					:items="statusItems"
					class="w-full"
				/>
				<USelect
					v-else-if="valueMode === 'visibility'"
					v-model="model.value"
					:items="visibilityItems"
					class="w-full"
				/>
				<USelect
					v-else-if="valueMode === 'lock'"
					v-model="model.value"
					:items="lockItems"
					class="w-full"
				/>
				<USelectMenu
					v-else-if="valueMode === 'label'"
					v-model="model.value"
					:items="labelItems"
					value-key="value"
					placeholder="Select a label"
					class="w-full"
				/>
				<div
					v-else-if="valueMode === 'color'"
					class="flex items-center gap-2"
				>
					<input
						v-model="model.value"
						type="color"
						class="h-9 w-14 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
					/>
					<UInput
						v-model="model.value"
						placeholder="#f97316"
						class="w-full"
					/>
				</div>
				<div
					v-else-if="valueMode === 'icon'"
					class="flex items-center gap-2"
				>
					<span
						class="flex size-9 shrink-0 items-center justify-center rounded border border-slate-200 dark:border-slate-700"
					>
						<UIcon
							v-if="model.value"
							:name="model.value"
							class="size-5"
						/>
						<UIcon
							v-else
							name="mdi:image-outline"
							class="size-5 text-slate-300"
						/>
					</span>
					<UInput
						v-model="model.value"
						placeholder="mdi:bug"
						class="w-full"
					/>
				</div>
				<UInput
					v-else
					v-model="model.value"
					:placeholder="textPlaceholder"
					class="w-full"
				/>
			</UFormField>

			<UButton
				color="error"
				variant="ghost"
				icon="mdi:close"
				size="sm"
				aria-label="Remove Action"
				@click="emit('remove')"
			/>
		</div>

		<template v-if="valueMode === 'message'">
			<UFormField size="sm">
				<template #label>
					<span class="flex items-center gap-1">
						{{ aiModel ? 'AI Fallback / Context' : 'Message Body' }}
						<UButton
							color="neutral"
							variant="ghost"
							icon="mdi:information-outline"
							size="xs"
							aria-label="Show Placeholders"
							@click="
								() => {
									placeholdersOpen = true;
								}
							"
						/>
					</span>
				</template>

				<div
					ref="bodyRoot"
					class="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
				>
					<div class="mb-2 flex flex-wrap items-center gap-1">
						<UButton
							color="neutral"
							variant="ghost"
							size="xs"
							icon="mdi:format-bold"
							aria-label="Bold"
							:disabled="preview"
							@click="wrap('**')"
						/>
						<UButton
							color="neutral"
							variant="ghost"
							size="xs"
							icon="mdi:format-italic"
							aria-label="Italic"
							:disabled="preview"
							@click="wrap('*')"
						/>
						<UButton
							color="neutral"
							variant="ghost"
							size="xs"
							icon="mdi:code-tags"
							aria-label="Inline Code"
							:disabled="preview"
							@click="wrap('`')"
						/>
						<UButton
							color="neutral"
							variant="ghost"
							size="xs"
							icon="mdi:link-variant"
							aria-label="Link"
							:disabled="preview"
							@click="wrap('[', '](https://)')"
						/>
						<UButton
							color="neutral"
							:variant="preview ? 'soft' : 'ghost'"
							size="xs"
							:icon="preview ? 'mdi:pencil-outline' : 'mdi:eye-outline'"
							class="ml-auto"
							@click="
								() => {
									preview = !preview;
								}
							"
							>{{ preview ? 'Edit' : 'Preview' }}</UButton
						>
					</div>

					<UTextarea
						v-show="!preview"
						v-model="model.value"
						:rows="3"
						autoresize
						:maxrows="12"
						:placeholder="bodyPlaceholder"
						class="w-full"
					/>
					<div
						v-show="preview"
						class="prose prose-sm min-h-16 max-w-none rounded-lg border border-slate-200 px-3 py-2 text-sm dark:prose-invert dark:border-slate-800"
					>
						<div
							v-if="model.value.trim()"
							v-html="rendered"
						/>
						<p
							v-else
							class="text-slate-400"
						>
							Nothing to preview yet.
						</p>
					</div>
				</div>
			</UFormField>

			<div class="flex flex-wrap items-center gap-x-6 gap-y-3">
				<div class="flex items-center gap-2">
					<USwitch v-model="aiModel" />
					<span class="text-sm">Use AI</span>
				</div>
				<div class="flex items-center gap-2">
					<USwitch v-model="autoSendModel" />
					<span class="text-sm">Auto-Send to Customer</span>
				</div>
				<UFormField
					label="Identity"
					size="sm"
					class="min-w-32"
				>
					<USelect
						v-model="identityModel"
						:items="identityItems"
						class="w-full"
					/>
				</UFormField>
			</div>
			<p class="text-xs text-slate-500">
				{{
					autoSendModel
						? 'Posts a customer-visible reply and emails it to the customer.'
						: 'Saved as an internal draft note for an agent to review before sending.'
				}}
			</p>
		</template>

		<FlowPlaceholders
			v-model:open="placeholdersOpen"
			:trigger="trigger"
		/>
	</div>
</template>

<script setup lang="ts">
import type { FlowAction, FlowTrigger } from '~/shared/types/ticket';
import { TicketPriority, TicketStatus, TicketVisibility } from '~/shared/types/ticket';

const model = defineModel<FlowAction>({ required: true });
defineProps<{
	trigger: FlowTrigger;
	labelItems: { label: string; value: string }[];
}>();
const emit = defineEmits<{ remove: [] }>();

const { renderMarkdown } = useMarkdown();

const bodyRoot = ref<HTMLElement | null>(null);
const preview = ref(false);
const placeholdersOpen = ref(false);

const actionItems = [
	{ label: 'Set Priority', value: 'set_priority', icon: 'mdi:flag-outline' },
	{ label: 'Set Status', value: 'set_status', icon: 'mdi:progress-check' },
	{ label: 'Set Visibility', value: 'set_visibility', icon: 'mdi:eye-outline' },
	{ label: 'Set Color', value: 'set_color', icon: 'mdi:palette-outline' },
	{ label: 'Set Icon', value: 'set_icon', icon: 'mdi:emoticon-outline' },
	{ label: 'Add Label', value: 'add_label', icon: 'mdi:tag-plus-outline' },
	{ label: 'Assign to User', value: 'assign', icon: 'mdi:account-check-outline' },
	{ label: 'Set Project', value: 'set_project', icon: 'mdi:folder-outline' },
	{ label: 'Lock Thread', value: 'lock_thread', icon: 'mdi:lock-outline' },
	{ label: 'Archive Ticket', value: 'archive', icon: 'mdi:archive-outline' },
	{ label: 'Reply in Thread', value: 'reply_in_thread', icon: 'mdi:reply-outline' },
	{ label: 'Email Customer', value: 'email_customer', icon: 'mdi:email-outline' }
];

const identityItems = [
	{ label: 'Team', value: 'team' },
	{ label: 'Automation', value: 'automation' }
];

const lockItems = [
	{ label: 'Lock Thread', value: '' },
	{ label: 'Unlock Thread', value: 'false' }
];

// shared display maps carry the colored leading icon + canonical label per enum value
const priorityItems = prioritySelectItems();
const statusItems = statusSelectItems();
const visibilityItems = visibilitySelectItems();

const valueMode = computed(() => {
	switch (model.value.type) {
		case 'set_priority':
			return 'priority';
		case 'set_status':
			return 'status';
		case 'set_visibility':
			return 'visibility';
		case 'add_label':
			return 'label';
		case 'set_color':
			return 'color';
		case 'set_icon':
			return 'icon';
		case 'lock_thread':
			return 'lock';
		case 'archive':
			return 'none';
		case 'reply_in_thread':
		case 'email_customer':
			return 'message';
		default:
			return 'text';
	}
});

const scalarMode = computed(() => valueMode.value !== 'none' && valueMode.value !== 'message');

const textPlaceholder = computed(() => {
	if (model.value.type === 'assign') return 'User ID';
	if (model.value.type === 'set_project') return 'Project ID';
	return 'Value';
});

const bodyPlaceholder = computed(() =>
	aiModel.value
		? 'Fallback text used when AI is unavailable. Supports {{placeholders}}.'
		: 'Message body. Supports markdown and {{placeholders}}.'
);

const rendered = computed(() => renderMarkdown(model.value.value || ''));

const aiModel = computed({
	get: () => model.value.ai ?? false,
	set: (v) => (model.value.ai = v)
});
const autoSendModel = computed({
	get: () => model.value.auto_send ?? false,
	set: (v) => (model.value.auto_send = v)
});
const identityModel = computed({
	get: () => model.value.identity ?? 'team',
	set: (v) => (model.value.identity = v as 'team' | 'automation')
});

// seed a sensible default when the action type changes so a control isn't left blank
function onTypeChange() {
	const type = model.value.type;
	if (type === 'reply_in_thread' || type === 'email_customer') {
		model.value.value = '';
		model.value.ai = false;
		model.value.auto_send = false;
		model.value.identity = 'team';
		return;
	}

	delete model.value.ai;
	delete model.value.auto_send;
	delete model.value.identity;
	switch (type) {
		case 'set_priority':
			model.value.value = TicketPriority.High;
			break;
		case 'set_status':
			model.value.value = TicketStatus.Open;
			break;
		case 'set_visibility':
			model.value.value = TicketVisibility.Private;
			break;
		case 'set_color':
			model.value.value = '#f97316';
			break;
		case 'set_icon':
			model.value.value = 'mdi:bug';
			break;
		default:
			model.value.value = '';
	}
}

function textarea(): HTMLTextAreaElement | null {
	return bodyRoot.value?.querySelector('textarea') ?? null;
}

// wrap the current selection with markdown markers
function wrap(before: string, after = before) {
	const el = textarea();
	if (!el) {
		model.value.value += before + after;
		return;
	}
	const start = el.selectionStart ?? 0;
	const end = el.selectionEnd ?? 0;
	const selected = model.value.value.slice(start, end);
	model.value.value =
		model.value.value.slice(0, start) + before + selected + after + model.value.value.slice(end);
	nextTick(() => {
		el.focus();
		el.setSelectionRange(start + before.length, start + before.length + selected.length);
	});
}
</script>
