<template>
	<div class="flex flex-col gap-4">
		<UFormField
			v-for="def in visibleFields"
			:key="def.key"
			:label="def.label"
			:required="def.required"
			size="sm"
		>
			<USelect
				v-if="def.type === 'select'"
				:model-value="value(def.key)"
				:items="def.options ?? []"
				:disabled="disabled"
				placeholder="Select an option"
				class="w-full"
				@update:model-value="(v) => set(def.key, String(v ?? ''))"
			/>

			<div
				v-else-if="def.type === 'multiselect'"
				class="flex flex-col gap-1"
			>
				<USelectMenu
					:model-value="multiSelected(def)"
					:items="def.options ?? []"
					multiple
					:disabled="disabled"
					placeholder="Select options"
					class="w-full"
					@update:model-value="(v) => onMulti(def, (v as string[]) ?? [])"
				/>
				<p
					v-if="ruleHint(def)"
					class="text-xs text-slate-500"
				>
					{{ ruleHint(def) }}
				</p>
			</div>

			<USelectMenu
				v-else-if="def.type === 'account'"
				:model-value="value(def.key)"
				:items="accountItems"
				value-key="value"
				:disabled="disabled"
				placeholder="Select a staff member"
				class="w-full"
				@update:model-value="(v) => set(def.key, String(v ?? ''))"
			/>

			<USelectMenu
				v-else-if="def.type === 'ticket'"
				:model-value="value(def.key)"
				:items="ticketItems"
				value-key="value"
				:disabled="disabled"
				placeholder="Select a ticket"
				class="w-full"
				@update:model-value="(v) => set(def.key, String(v ?? ''))"
			/>

			<USelectMenu
				v-else-if="def.type === 'customer'"
				:model-value="value(def.key)"
				:items="customerItems"
				value-key="value"
				:disabled="disabled"
				placeholder="Select a customer"
				class="w-full"
				@update:model-value="(v) => set(def.key, String(v ?? ''))"
			/>

			<USelectMenu
				v-else-if="def.type === 'label'"
				:model-value="value(def.key)"
				:items="labelItems"
				value-key="value"
				:disabled="disabled"
				placeholder="Select a label"
				class="w-full"
				@update:model-value="(v) => set(def.key, String(v ?? ''))"
			/>

			<div v-else-if="def.type === 'file'">
				<div
					v-if="value(def.key)"
					class="flex items-center gap-2"
				>
					<UIcon
						name="mdi:file-outline"
						class="text-slate-500"
					/>
					<a
						:href="fileHref(value(def.key))"
						target="_blank"
						class="truncate text-sm text-primary-500 underline"
						>{{ fileName(value(def.key)) }}</a
					>
					<UButton
						v-if="!disabled"
						size="xs"
						color="error"
						variant="ghost"
						icon="mdi:close"
						aria-label="Remove File"
						@click="set(def.key, '')"
					/>
				</div>
				<UFileUpload
					v-else
					:disabled="disabled || !!uploading[def.key] || (needsTurnstile && !turnstileToken)"
					class="w-full"
					@update:model-value="(f: unknown) => onFile(def.key, f as File | File[] | null)"
				/>
			</div>

			<UCheckbox
				v-else-if="def.type === 'checkbox'"
				:model-value="value(def.key) === 'true'"
				:disabled="disabled"
				@update:model-value="(v) => set(def.key, v ? 'true' : '')"
			/>

			<UInput
				v-else
				:model-value="value(def.key)"
				:type="inputType(def.type)"
				:disabled="disabled"
				class="w-full"
				@update:model-value="(v) => set(def.key, String(v ?? ''))"
			/>
		</UFormField>

		<TurnstileWidget
			v-if="needsTurnstile && hasFileField"
			@received-token="turnstileToken = $event"
		/>

		<p
			v-if="!visibleFields.length"
			class="text-xs text-slate-500"
		>
			No custom fields are defined yet.
		</p>
	</div>
</template>

<script setup lang="ts">
import type { CustomFieldDef, CustomFieldType, Ticket } from '~/shared/types/ticket';
import type { Customer, Label, User } from '~/shared/types/user';

const props = withDefaults(
	defineProps<{
		modelValue?: Record<string, string>;
		defs?: CustomFieldDef[];
		disabled?: boolean;
		// public hides reference types (account/ticket/customer/label) that expose internal data
		context?: 'staff' | 'public';
	}>(),
	{ modelValue: () => ({}), disabled: false, context: 'staff' }
);

const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string>] }>();

// fall back to the globally-defined fields when the parent doesn't pass explicit defs
const { fields: definedFields } = useCustomFields();
const fields = computed<CustomFieldDef[]>(() => props.defs ?? definedFields.value);

// reference types leak internal data; never render them on the public submit/status surface
const REFERENCE_TYPES: CustomFieldType[] = ['account', 'ticket', 'customer', 'label'];
const visibleFields = computed<CustomFieldDef[]>(() =>
	props.context === 'public'
		? fields.value.filter((def) => !REFERENCE_TYPES.includes(def.type))
		: fields.value
);

// turnstile only guards the public file-upload endpoint; staff are exempt server-side
const config = useRuntimeConfig();
const turnstileActive = computed(() => !!config.public.turnstile?.siteKey);
const turnstileToken = ref('');
const needsTurnstile = computed(() => props.context === 'public' && turnstileActive.value);
const hasFileField = computed(() => visibleFields.value.some((def) => def.type === 'file'));

const value = (key: string): string => props.modelValue?.[key] ?? '';

function set(key: string, next: string) {
	emit('update:modelValue', { ...(props.modelValue ?? {}), [key]: next });
}

function inputType(type: CustomFieldType): string {
	if (type === 'number') return 'number';
	if (type === 'date') return 'date';
	return 'text';
}

// #region multiselect

function multiSelected(def: CustomFieldDef): string[] {
	const raw = value(def.key);
	return raw
		? raw
				.split(',')
				.map((item) => item.trim())
				.filter((item) => item.length > 0)
		: [];
}

// exactly/up_to cap how many can be picked; at_least/all/any have no upper bound
function maxFor(def: CustomFieldDef): number | null {
	const rule = def.selection?.rule;
	const count = def.selection?.count;
	if ((rule === 'exactly' || rule === 'up_to') && count) return count;
	return null;
}

function onMulti(def: CustomFieldDef, next: string[]) {
	const max = maxFor(def);
	if (max != null && next.length > max) return; // disable adding past the cap
	set(def.key, next.join(','));
}

function ruleHint(def: CustomFieldDef): string {
	const rule = def.selection?.rule;
	const count = def.selection?.count;
	if (rule === 'exactly' && count) return `Choose exactly ${count}`;
	if (rule === 'up_to' && count) return `Choose up to ${count}`;
	if (rule === 'at_least' && count) return `Choose at least ${count}`;
	if (rule === 'all') return 'Choose all';
	return '';
}

// #endregion

// #region reference data (staff only)

const userStore = useUserStore();
const ticketStore = useTicketStore();
const customerStore = useCustomerStore();
const labelsStore = useLabelsStore();

const accounts = ref<User[]>([]);
const tickets = ref<Ticket[]>([]);
const customers = ref<Customer[]>([]);
const labels = ref<Label[]>([]);

const hasType = (type: CustomFieldType) => fields.value.some((def) => def.type === type);

// ids are stringified so the string model-value matches the item value across all reference types
const accountItems = computed(() =>
	accounts.value.map((account) => ({
		label: displayName(account) || account.username,
		value: account.id,
		avatar: accountAvatar(account)
	}))
);
const ticketItems = computed(() =>
	tickets.value.map((ticket) => ({
		label: `#${ticket.id} - ${ticket.title}`,
		value: String(ticket.id)
	}))
);
const customerItems = computed(() =>
	customers.value.map((customer) => ({
		label: customer.name || customer.email,
		value: String(customer.id)
	}))
);
const labelItems = computed(() =>
	labels.value.map((label) => ({ label: label.name, value: String(label.id) }))
);

function accountAvatar(account: User): { src: string } | undefined {
	const avatar = account.avatar_url;
	if (!avatar || avatar.startsWith('icon:')) return undefined;
	if (avatar === 'local') return { src: `/api/users/${account.id}/avatar` };
	if (/^https?:\/\//i.test(avatar)) return { src: avatar };
	return undefined;
}

async function loadReferenceData() {
	if (props.context !== 'staff') return;
	if (hasType('account') && !accounts.value.length) accounts.value = await userStore.listUsers();
	if (hasType('ticket') && !tickets.value.length) tickets.value = await ticketStore.listTickets();
	if (hasType('customer') && !customers.value.length)
		customers.value = await customerStore.listCustomers();
	if (hasType('label') && !labels.value.length) labels.value = await labelsStore.listLabels();
}

onMounted(loadReferenceData);
watch(fields, loadReferenceData, { deep: true });

// #endregion

// #region file upload

const uploading = reactive<Record<string, boolean>>({});
// remember freshly-uploaded names for display; the stored value is only the blob key
const fileNames = reactive<Record<string, string>>({});

function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

async function onFile(key: string, selected: File | File[] | null) {
	const file = Array.isArray(selected) ? selected[0] : selected;
	if (!file) return;
	uploading[key] = true;
	try {
		const dataUrl = await readAsDataUrl(file);
		const res = await $fetch<{ key: string; name: string }>('/api/custom-fields/file', {
			method: 'POST',
			body: {
				base64: dataUrl,
				name: file.name,
				...(needsTurnstile.value ? { turnstile: turnstileToken.value } : {})
			},
			headers: needsTurnstile.value ? { 'x-turnstile-token': turnstileToken.value } : undefined,
			credentials: 'include'
		});
		fileNames[res.key] = res.name;
		set(key, res.key);
	} catch (error) {
		console.error('Failed to upload file:', error);
	} finally {
		uploading[key] = false;
	}
}

function fileName(key: string): string {
	return fileNames[key] || key.replace(/^custom-field\//, '') || 'Attached File';
}

function fileHref(key: string): string {
	return `/api/custom-fields/file/${encodeURIComponent(key.replace(/^custom-field\//, ''))}`;
}

// #endregion
</script>
