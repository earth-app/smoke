import { blob } from 'hub:blob';
import z from 'zod';

const paramsSchema = z.object({ key: z.string().min(1).max(160) });

export default defineEventHandler(async (event) => {
	const { key } = await getValidatedRouterParams(event, paramsSchema.parse);

	// accept either the full blob key or the bare hash; always rebuild under the custom-field/ prefix
	const stripped = key.startsWith('custom-field/') ? key.slice('custom-field/'.length) : key;
	if (!/^[a-f0-9]{16,128}$/i.test(stripped)) {
		throw createError({ statusCode: 400, message: 'Invalid file key' });
	}
	const blobKey = `custom-field/${stripped}`;

	const file = await blob.get(blobKey);
	if (!file) {
		throw createError({ statusCode: 404, message: 'File not found' });
	}

	event.node.res.setHeader('Content-Type', file.type || 'application/octet-stream');
	event.node.res.setHeader('Content-Length', file.size.toString());
	event.node.res.setHeader('Content-Disposition', `inline; filename="${stripped}"`);
	event.node.res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

	return sendStream(event, file.stream());
});
