import { blob } from 'hub:blob';
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

	const avatarUrl = user.avatar_url;

	if (!avatarUrl) {
		throw createError({
			statusCode: 404,
			message: 'User does not have an avatar',
			data: { param: id, success: false }
		});
	}

	// iconify avatar has no image; the client wrapper renders the icon directly
	if (avatarUrl.startsWith('icon:')) {
		throw createError({
			statusCode: 404,
			message: 'User avatar is an icon, not an image',
			data: { param: id, success: false }
		});
	}

	// proxy external urls; "local" means an uploaded blob
	if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
		return sendRedirect(event, avatarUrl);
	}

	if (avatarUrl.toLowerCase() === 'local') {
		const avatar = await blob.get(`avatar/${user.id}`);

		if (!avatar) {
			throw createError({
				statusCode: 404,
				message: 'Avatar not found',
				data: { param: id, success: false }
			});
		}

		event.node.res.setHeader('Content-Type', avatar.type || 'application/octet-stream');
		event.node.res.setHeader('Content-Length', avatar.size.toString());
		event.node.res.setHeader('Content-Disposition', `inline; filename="${user.name || 'avatar'}"`);
		event.node.res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

		return sendStream(event, avatar.stream());
	}
});
