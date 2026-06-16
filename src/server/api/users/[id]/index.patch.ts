import z from 'zod';
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

	// avatar is managed via POST/DELETE /api/users/[id]/avatar, not here
	if (body.avatar_url !== undefined) {
		throw createError({
			statusCode: 400,
			message: 'Set the avatar through the avatar endpoints, not this route',
			data: { success: false }
		});
	}

	const updatedUser = await patchUser(target, body, event.context.cloudflare.env);
	return updatedUser;
});
