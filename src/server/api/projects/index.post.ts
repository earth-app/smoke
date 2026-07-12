import z from 'zod';
import { Permission } from '~/shared/types/user';

const bodySchema = z.object({
	name: z.string().min(1).max(120),
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

	const body = await readValidatedBody(event, bodySchema.parse);

	try {
		return await createProject(body);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to create project',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
