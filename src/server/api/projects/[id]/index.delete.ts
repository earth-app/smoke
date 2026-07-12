import z from 'zod';
import { Permission } from '~/shared/types/user';

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageSettings)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const { id } = await getValidatedRouterParams(event, paramsSchema.parse);
	const existing = await getProjectById(id);
	if (!existing) {
		throw createError({ statusCode: 404, message: 'Project not found' });
	}

	try {
		await deleteProject(id);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to delete project',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}

	return sendNoContent(event);
});
