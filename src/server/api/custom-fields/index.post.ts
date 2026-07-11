import z from 'zod';
import type { CustomFieldDef } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';

const fieldSchema = z.object({
	key: z.string().max(64).optional(),
	label: z.string().min(1).max(120),
	type: z.enum([
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
	]),
	options: z.array(z.string().max(120)).max(50).optional(),
	required: z.boolean().optional(),
	// multiselect-only selection rule (normalizeField drops it for other types)
	selection: z
		.object({
			rule: z.enum(['any', 'at_least', 'exactly', 'up_to', 'all']),
			count: z.number().int().positive().optional()
		})
		.optional()
});

const bodySchema = z.object({ fields: z.array(fieldSchema).max(50) });

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageSettings)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const body = await readValidatedBody(event, bodySchema.parse);

	try {
		return await saveCustomFields(body.fields as Array<Partial<CustomFieldDef>>);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to save custom fields',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
