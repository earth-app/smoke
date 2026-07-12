import { blob } from 'hub:blob';
import z from 'zod';

// ~10mb cap; base64 inflates ~4/3 so the string bound is a little larger
const MAX_BYTES = 10 * 1024 * 1024;

const bodySchema = z.object({
	base64: z
		.string()
		.min(1)
		.max(15_000_000)
		.regex(/^data:[^;,]*(?:;[^;,]+)*;base64,[A-Za-z0-9+/]+={0,2}$/, 'Invalid base64 data uri'),
	name: z.string().min(1).max(255).optional(),
	turnstile: z.string().max(4096).optional()
});

export default defineEventHandler(async (event) => {
	// staff and unauthenticated (public submit) callers both allowed; the size cap is the guard
	const user = await getOptionalLoggedIn(event);

	let bytes: Uint8Array;
	let name: string;
	let type: string;
	// public callers carry the captcha token in a field or the x-turnstile-token header
	let turnstileToken = getHeader(event, 'x-turnstile-token') || undefined;

	const contentType = getHeader(event, 'content-type') || '';
	if (contentType.includes('multipart/form-data')) {
		const form = await readMultipartFormData(event);
		const file = form?.find((part) => part.name === 'file' && part.data?.length);
		if (!file) {
			throw createError({ statusCode: 400, message: 'No file provided' });
		}
		bytes = new Uint8Array(file.data);
		name = file.filename || 'file';
		type = file.type || 'application/octet-stream';
		const tokenPart = form?.find((part) => part.name === 'turnstile' && part.data?.length);
		if (tokenPart) turnstileToken = Buffer.from(tokenPart.data).toString('utf8');
	} else {
		const body = await readValidatedBody(event, bodySchema.parse);
		// mime sits between "data:" and the first ";" or ","
		type = body.base64.slice(5).split(/[;,]/)[0] || 'application/octet-stream';
		const data = body.base64.slice(body.base64.indexOf(',') + 1);
		bytes = new Uint8Array(Buffer.from(data, 'base64'));
		name = body.name || 'file';
		turnstileToken = turnstileToken || body.turnstile;
	}

	// only public (unauthenticated) uploads must clear the captcha
	if (!user) await verifyTurnstile(event, turnstileToken);

	if (bytes.byteLength > MAX_BYTES) {
		throw createError({ statusCode: 413, message: 'File is too large (max 10MB)' });
	}

	// content-addressed key: identical bytes dedupe to the same blob, no clock/random needed
	const digest = await crypto.subtle.digest('SHA-256', toBufferSource(bytes));
	const hash = bytesToHex(new Uint8Array(digest));
	const key = `custom-field/${hash}`;

	await blob.put(key, bytes, { contentType: type });
	return { key, name, size: bytes.byteLength, type };
});
