import { blob } from 'hub:blob';
import z from 'zod';
import { Permission, Role } from '~/shared/types/user';
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

	// relationship gate (self needs ManageSelf, others need ManageUsers/admin)
	await ensureCanWriteTo(current, target);

	// capability gate; every avatar change requires ChangeAvatar (admins have it by default)
	if (!current.permissions.includes(Permission.ChangeAvatar)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to change avatars',
			data: { success: false }
		});
	}

	// per-site policy applies only to an agent editing their OWN avatar; managers/owners bypass
	const isSelfAgent = current.id === target.id && current.role === Role.Agent;
	const avatarPolicy = isSelfAgent ? await getAvatarPolicy() : null;
	if (avatarPolicy && !avatarPolicy.agent_can_change) {
		throw createError({
			statusCode: 403,
			message: 'Avatar changes are disabled for your account',
			data: { success: false }
		});
	}
	// image uploads (multipart + base64) may be disabled while icon/url stays allowed
	const uploadBlocked = !!avatarPolicy && !avatarPolicy.agent_can_upload;

	// multipart upload: read the "avatar" file part and store it as a blob
	const contentType = getHeader(event, 'content-type') || '';
	if (contentType.includes('multipart/form-data')) {
		if (uploadBlocked) {
			throw createError({
				statusCode: 403,
				message: 'Image uploads are disabled; choose an icon or link an image url',
				data: { success: false }
			});
		}
		const form = await readMultipartFormData(event);
		const file = form?.find((part) => part.name === 'avatar' && part.data?.length);
		if (!file) {
			throw createError({
				statusCode: 400,
				message: 'No avatar file provided',
				data: { success: false }
			});
		}

		await blob.put(`avatar/${target.id}`, file.data, {
			contentType: file.type || 'application/octet-stream'
		});
		return await patchUser(target, { avatar_url: 'local' }, event.context.cloudflare.env);
	}

	// json body: exactly one of icon, url (https), or base64 (data uri)
	const bodyType = z.union([
		z.object({
			icon: schemas.avatar_icon,
			url: z.never().optional(),
			base64: z.never().optional()
		}),
		z.object({
			url: schemas.avatar_url.unwrap(),
			base64: z.never().optional(),
			icon: z.never().optional()
		}),
		z.object({
			url: z.never().optional(),
			icon: z.never().optional(),
			base64: z
				.string()
				.regex(
					/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/,
					'Invalid base64 image string'
				)
		})
	]);

	const { url, base64, icon } = await readValidatedBody(event, bodyType.parse);

	// iconify avatar; stored via the `icon:` sentinel, no blob involved
	if (icon) {
		return await patchUser(target, { avatar_url: `icon:${icon}` }, event.context.cloudflare.env);
	}

	// already validated as an https url by schema
	if (url) {
		return await patchUser(target, { avatar_url: url }, event.context.cloudflare.env);
	}

	if (base64) {
		if (uploadBlocked) {
			throw createError({
				statusCode: 403,
				message: 'Image uploads are disabled; choose an icon or link an image url',
				data: { success: false }
			});
		}
		// base64 data uri -> blob, mark avatar_url as "local"
		const mimeMatch = base64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
		if (!mimeMatch) {
			throw createError({
				statusCode: 400,
				message: 'Invalid base64 image string',
				data: { success: false }
			});
		}

		const buffer = Buffer.from(base64.split(',')[1]!, 'base64');
		await blob.put(`avatar/${target.id}`, buffer, { contentType: mimeMatch[1] });
		return await patchUser(target, { avatar_url: 'local' }, event.context.cloudflare.env);
	}

	throw createError({
		statusCode: 400,
		message: 'No valid avatar data provided',
		data: { success: false }
	});
});
