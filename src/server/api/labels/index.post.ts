import { createLabel, ensureLoggedIn } from '~/server/utils';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageLabels)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const body = await readValidatedBody(event, schemas.labelCreateBody.parse);

	try {
		return await createLabel(body.name, body.color);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to create label',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
