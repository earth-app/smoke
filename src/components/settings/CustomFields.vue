<template>
	<div class="flex flex-col gap-4">
		<div
			class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
		>
			<div
				v-if="!draft.length"
				class="px-1 py-6 text-center text-sm text-slate-500"
			>
				No custom fields yet. Add one to collect extra data on tickets.
			</div>

			<div
				v-for="(field, index) in draft"
				:key="index"
				class="flex flex-wrap items-end gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0 dark:border-slate-800"
			>
				<UFormField
					label="Label"
					size="sm"
					class="min-w-40 flex-1"
				>
					<UInput
						v-model="field.label"
						placeholder="Order Number"
						:disabled="!canManage"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Type"
					size="sm"
				>
					<USelect
						v-model="field.type"
						:items="typeItems"
						value-key="value"
						:disabled="!canManage"
						class="w-40"
					>
						<template #leading="{ modelValue }">
							<UIcon
								v-if="modelValue"
								:name="typeIcons[modelValue as CustomFieldType]"
							/>
						</template>
					</USelect>
				</UFormField>
				<UFormField
					v-if="field.type === 'select' || field.type === 'multiselect'"
					label="Options"
					size="sm"
					class="min-w-40 flex-1"
				>
					<UInput
						v-model="field.options"
						placeholder="Comma, separated, values"
						:disabled="!canManage"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					v-if="field.type === 'multiselect'"
					label="Selection Rule"
					size="sm"
				>
					<USelect
						v-model="field.rule"
						:items="ruleItems"
						value-key="value"
						:disabled="!canManage"
						class="w-40"
					/>
				</UFormField>
				<UFormField
					v-if="field.type === 'multiselect' && countedRule(field.rule)"
					label="Count"
					size="sm"
				>
					<UInput
						v-model.number="field.count"
						type="number"
						:min="1"
						:disabled="!canManage"
						class="w-24"
					/>
				</UFormField>
				<UFormField
					label="Required"
					size="sm"
				>
					<UCheckbox
						v-model="field.required"
						:disabled="!canManage"
					/>
				</UFormField>
				<div
					v-if="canManage"
					class="flex items-center gap-1 pb-1"
				>
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						icon="mdi:arrow-up"
						aria-label="Move Up"
						:disabled="index === 0"
						@click="move(index, -1)"
					/>
					<UButton
						size="xs"
						color="neutral"
						variant="ghost"
						icon="mdi:arrow-down"
						aria-label="Move Down"
						:disabled="index === draft.length - 1"
						@click="move(index, 1)"
					/>
					<UButton
						size="xs"
						color="error"
						variant="ghost"
						icon="mdi:delete-outline"
						aria-label="Remove Field"
						@click="removeField(index)"
					/>
				</div>
			</div>
		</div>

		<div
			v-if="canManage"
			class="flex items-center justify-between"
		>
			<UButton
				color="neutral"
				variant="soft"
				icon="mdi:plus"
				@click="addField"
				>Add Field</UButton
			>
			<UButton
				color="primary"
				icon="mdi:content-save-outline"
				:loading="saving"
				@click="onSave"
				>Save Fields</UButton
			>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { CustomFieldDef, CustomFieldType, MultiSelectRule } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';

type DraftField = {
	key: string;
	label: string;
	type: CustomFieldType;
	options: string;
	required: boolean;
	rule: MultiSelectRule;
	count: number;
};

// rules that pair with a numeric count
const COUNTED_RULES: MultiSelectRule[] = ['at_least', 'exactly', 'up_to'];
const countedRule = (rule: MultiSelectRule) => COUNTED_RULES.includes(rule);

const toast = useToast();
const { can, isAdmin } = useAuth();
const { fields, saveFields } = useCustomFields();

const canManage = computed(() => isAdmin.value || can(Permission.ManageSettings));

const typeIcons: Record<CustomFieldType, string> = {
	text: 'mdi:form-textbox',
	number: 'mdi:numeric',
	select: 'mdi:form-dropdown',
	multiselect: 'mdi:checkbox-multiple-marked-outline',
	date: 'mdi:calendar',
	checkbox: 'mdi:checkbox-marked-outline',
	account: 'mdi:account',
	ticket: 'mdi:ticket-outline',
	customer: 'mdi:account-box-outline',
	label: 'mdi:label-outline',
	file: 'mdi:file-upload-outline'
};

const typeItems = [
	{ label: 'Text', value: 'text', icon: typeIcons.text },
	{ label: 'Number', value: 'number', icon: typeIcons.number },
	{ label: 'Select', value: 'select', icon: typeIcons.select },
	{ label: 'Multi-select', value: 'multiselect', icon: typeIcons.multiselect },
	{ label: 'Date', value: 'date', icon: typeIcons.date },
	{ label: 'Checkbox', value: 'checkbox', icon: typeIcons.checkbox },
	{ label: 'Account', value: 'account', icon: typeIcons.account },
	{ label: 'Ticket', value: 'ticket', icon: typeIcons.ticket },
	{ label: 'Customer', value: 'customer', icon: typeIcons.customer },
	{ label: 'Label', value: 'label', icon: typeIcons.label },
	{ label: 'File Upload', value: 'file', icon: typeIcons.file }
];

const ruleItems = [
	{ label: 'Any Number', value: 'any' },
	{ label: 'At Least', value: 'at_least' },
	{ label: 'Exactly', value: 'exactly' },
	{ label: 'Up To', value: 'up_to' },
	{ label: 'All', value: 'all' }
];

const draft = ref<DraftField[]>([]);
const saving = ref(false);

// resync the editable draft whenever the canonical saved fields change (initial load + after save)
watch(
	fields,
	(value) => {
		draft.value = value.map((def) => ({
			key: def.key,
			label: def.label,
			type: def.type,
			options: (def.options ?? []).join(', '),
			required: !!def.required,
			rule: def.selection?.rule ?? 'any',
			count: def.selection?.count ?? 1
		}));
	},
	{ immediate: true, deep: true }
);

function addField() {
	draft.value = [
		...draft.value,
		{ key: '', label: '', type: 'text', options: '', required: false, rule: 'any', count: 1 }
	];
}

function removeField(index: number) {
	draft.value = draft.value.filter((_, i) => i !== index);
}

function move(index: number, direction: number) {
	const target = index + direction;
	if (target < 0 || target >= draft.value.length) return;
	const next = [...draft.value];
	const [item] = next.splice(index, 1);
	next.splice(target, 0, item!);
	draft.value = next;
}

async function onSave() {
	saving.value = true;
	try {
		const defs: CustomFieldDef[] = draft.value
			.filter((field) => field.label.trim())
			.map((field) => {
				const def: CustomFieldDef = {
					key: field.key,
					label: field.label.trim(),
					type: field.type
				};
				if (field.type === 'select' || field.type === 'multiselect') {
					def.options = field.options
						.split(',')
						.map((option) => option.trim())
						.filter((option) => option.length > 0);
				}
				if (field.type === 'multiselect') {
					const selection: { rule: MultiSelectRule; count?: number } = { rule: field.rule };
					if (countedRule(field.rule)) selection.count = Math.max(1, Math.floor(field.count || 1));
					def.selection = selection;
				}
				if (field.required) def.required = true;
				return def;
			});

		await saveFields(defs);
		toast.add({
			title: 'Custom Fields Saved',
			description: 'Your custom field definitions were updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Save Custom Fields',
			description: extractServerMessage(error, 'Could not save the fields. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
