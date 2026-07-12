import z from 'zod';
import { Permission } from '~/shared/types/user';

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

const bodySchema = z.object({
	name: z.string().min(1).max(120).optional(),
	description: z.string().max(2000).optional(),
	color: z
		.string()
		.regex(/^#([0-9a-fA-F]{3}){1,2}$/, 'Color must be a hex value')
		.optional()
});

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageSettings)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const { id } = await getValidatedRouterParams(event, paramsSchema.parse);
	const body = await readValidatedBody(event, bodySchema.parse);

	try {
		return await updateProject(id, body);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to update project',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
