import z from 'zod';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({
	email: schemas.email,
	code: z
		.string()
		.trim()
		.regex(/^\d{6}$/, 'Enter the 6-digit code')
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	const body = await readValidatedBody(event, bodySchema.parse);

	const customer = await verifyCustomerOtp(body.email, body.code, event, env);
	return { customer };
});
