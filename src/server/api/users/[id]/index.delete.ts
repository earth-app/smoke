import z from 'zod';
import { deleteUser, ensureCanWriteTo, ensureLoggedIn, getUserBy } from '~/server/utils';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	const { id } = await getValidatedRouterParams(event, z.object({ id: schemas.userIdParam }).parse);
	const target = await getUserBy(id, event);

	if (!target) {
		throw createError({
			statusCode: 404,
			message: 'User not found',
			data: { param: id, success: false }
		});
	}

	await ensureCanWriteTo(current, target);

	try {
		await deleteUser(target.id);
	} catch (error) {
		throw createError({
			statusCode: 500,
			message: 'Failed to delete user',
			data: { error: error instanceof Error ? error.message : String(error), success: false }
		});
	}

	return sendNoContent(event);
});
