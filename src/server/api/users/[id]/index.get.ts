import z from 'zod';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, z.object({ id: schemas.userIdParam }).parse);
	const user = await getUserBy(id, event);

	if (!user) {
		throw createError({
			statusCode: 404,
			message: 'User not found',
			data: { param: id, success: false }
		});
	}

	// flag the founding owner so the client can render owner role-context (owner = a locked admin)
	return { ...user, is_owner: await isOwnerUser(user.id) };
});
