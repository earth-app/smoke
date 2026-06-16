import { blob } from 'hub:blob';
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

	// delete avatar from blob storage if it's a local avatar
	if (target.avatar_url === 'local') {
		try {
			await blob.delete(`avatar/${target.id}`);
		} catch (error) {
			console.error('Failed to delete avatar from blob storage:', error);
			// continue with deletion of user record even if blob deletion fails
		}
	}

	target.avatar_url = undefined;
	const updatedUser = await patchUser(
		target,
		{ avatar_url: undefined },
		event.context.cloudflare.env
	);
	return updatedUser;
});
