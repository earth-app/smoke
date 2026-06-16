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

	// multipart upload: read the "avatar" file part and store it as a blob
	const contentType = getHeader(event, 'content-type') || '';
	if (contentType.includes('multipart/form-data')) {
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

	// json body: exactly one of url (https) or base64 (data uri)
	const bodyType = z.union([
		z.object({ url: schemas.avatar_url.unwrap(), base64: z.never().optional() }),
		z.object({
			url: z.never().optional(),
			base64: z
				.string()
				.regex(
					/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/,
					'Invalid base64 image string'
				)
		})
	]);

	const { url, base64 } = await readValidatedBody(event, bodyType.parse);

	// already validated as an https url by schema
	if (url) {
		return await patchUser(target, { avatar_url: url }, event.context.cloudflare.env);
	}

	if (base64) {
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
