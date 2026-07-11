import type { CustomFieldDef, CustomFieldType, MultiSelectRule } from '~/shared/types/ticket';

// custom-field definitions live in settings kv; a save replaces the whole ordered list
const KEY = 'smoke:setting:custom_fields';

const FIELD_TYPES: CustomFieldType[] = [
	'text',
	'number',
	'select',
	'multiselect',
	'date',
	'checkbox',
	'account',
	'ticket',
	'customer',
	'label',
	'file'
];

// types that carry a user-defined option list
const OPTION_TYPES: CustomFieldType[] = ['select', 'multiselect'];

const SELECTION_RULES: MultiSelectRule[] = ['any', 'at_least', 'exactly', 'up_to', 'all'];
// rules that pair with a numeric count
const COUNTED_RULES: MultiSelectRule[] = ['at_least', 'exactly', 'up_to'];

// derive a stable kv-safe key from a label when none is provided
function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

function normalizeField(field: Partial<CustomFieldDef>): CustomFieldDef | null {
	const rawKey = typeof field.key === 'string' ? field.key : '';
	const rawLabel = typeof field.label === 'string' ? field.label : '';
	const key = slugify(rawKey) || slugify(rawLabel);
	if (!key) return null;

	const type: CustomFieldType = FIELD_TYPES.includes(field.type as CustomFieldType)
		? (field.type as CustomFieldType)
		: 'text';

	const def: CustomFieldDef = { key, label: rawLabel.trim() || key, type };

	if (OPTION_TYPES.includes(type)) {
		const options = Array.isArray(field.options)
			? field.options.map((option) => String(option).trim()).filter((option) => option.length > 0)
			: [];
		def.options = Array.from(new Set(options));
	}

	if (type === 'multiselect') {
		const raw = (field.selection ?? {}) as Partial<{ rule: MultiSelectRule; count: number }>;
		const rule: MultiSelectRule = SELECTION_RULES.includes(raw.rule as MultiSelectRule)
			? (raw.rule as MultiSelectRule)
			: 'any';
		const selection: { rule: MultiSelectRule; count?: number } = { rule };
		if (COUNTED_RULES.includes(rule)) {
			const count = Number(raw.count);
			selection.count = Number.isInteger(count) && count > 0 ? count : 1;
		}
		def.selection = selection;
	}

	if (field.required) def.required = true;
	return def;
}

export async function listCustomFields(): Promise<CustomFieldDef[]> {
	try {
		const raw = await kv.get<CustomFieldDef[]>(KEY, 'json');
		if (!Array.isArray(raw)) return [];
		const seen = new Set<string>();
		const fields: CustomFieldDef[] = [];
		for (const field of raw) {
			const def = normalizeField(field);
			if (!def || seen.has(def.key)) continue;
			seen.add(def.key);
			fields.push(def);
		}
		return fields;
	} catch {
		return [];
	}
}

export async function saveCustomFields(
	input: Array<Partial<CustomFieldDef>>
): Promise<CustomFieldDef[]> {
	const seen = new Set<string>();
	const fields: CustomFieldDef[] = [];
	for (const field of input) {
		const def = normalizeField(field);
		if (!def || seen.has(def.key)) continue; // keys must be unique
		seen.add(def.key);
		fields.push(def);
	}
	await kv.set(KEY, JSON.stringify(fields));
	return fields;
}

// validate a ticket's stored custom-field values against their definitions; throws a 400 on the
// first violation (required, unknown option, or an unmet multiselect selection rule). best-effort:
// a field with no matching def or empty optional value is skipped
export function validateCustomFieldValues(
	defs: CustomFieldDef[],
	values: Record<string, string> | null | undefined
): void {
	if (!Array.isArray(defs) || defs.length === 0) return;
	const map = values ?? {};

	for (const def of defs) {
		const raw = typeof map[def.key] === 'string' ? map[def.key]!.trim() : '';

		if (def.required && !raw) {
			throw createError({ statusCode: 400, message: `"${def.label}" is required` });
		}
		if (!raw) continue; // empty optional value: nothing else to check

		const options = Array.isArray(def.options) ? def.options : [];

		if (def.type === 'select') {
			if (options.length && !options.includes(raw)) {
				throw createError({
					statusCode: 400,
					message: `"${raw}" is not a valid option for "${def.label}"`
				});
			}
			continue;
		}

		if (def.type === 'multiselect') {
			const picked = raw
				.split(',')
				.map((item) => item.trim())
				.filter((item) => item.length > 0);
			for (const item of picked) {
				if (options.length && !options.includes(item)) {
					throw createError({
						statusCode: 400,
						message: `"${item}" is not a valid option for "${def.label}"`
					});
				}
			}

			const count = Array.from(new Set(picked)).length;
			const rule = def.selection?.rule ?? 'any';
			const want = def.selection?.count;

			if (rule === 'all' && options.length && count !== options.length) {
				throw createError({
					statusCode: 400,
					message: `"${def.label}" requires selecting all ${options.length} options`
				});
			}
			if (rule === 'exactly' && want != null && count !== want) {
				throw createError({
					statusCode: 400,
					message: `"${def.label}" requires exactly ${want} selection(s)`
				});
			}
			if (rule === 'at_least' && want != null && count < want) {
				throw createError({
					statusCode: 400,
					message: `"${def.label}" requires at least ${want} selection(s)`
				});
			}
			if (rule === 'up_to' && want != null && count > want) {
				throw createError({
					statusCode: 400,
					message: `"${def.label}" allows up to ${want} selection(s)`
				});
			}
		}
	}
}
