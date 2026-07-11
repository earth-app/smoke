import z from 'zod';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({
	email: schemas.email,
	code: z
		.string()
		.trim()
		.regex(/^\d{8}$/, 'Enter the 8-digit code'),
	password: schemas.passwordParam
});

// public: verify the 8-digit code and set the new password
export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	const body = await readValidatedBody(event, bodySchema.parse);

	await verifyAgentPasswordReset(body.email, body.code, body.password, env);
	return { success: true };
});
