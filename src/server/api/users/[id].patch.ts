import z from 'zod';
import { ensureCanWriteTo, ensureLoggedIn, getUserBy, patchUser } from '~/server/utils';
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

	const body = await readValidatedBody(event, schemas.userPatchBody.parse);
	const updatedUser = await patchUser(target, body, event.context.cloudflare.env);
	return updatedUser;
});
