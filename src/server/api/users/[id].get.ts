import z from 'zod';
import { getUserBy } from '~/server/utils';
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

	return user;
});
