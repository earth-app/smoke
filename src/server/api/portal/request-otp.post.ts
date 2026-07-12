import z from 'zod';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({
	email: schemas.email,
	turnstile: z.string().max(4096).optional()
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	const body = await readValidatedBody(event, bodySchema.parse);

	// captcha gate before issuing an otp (no-op unless turnstile is configured)
	await verifyTurnstile(event, body.turnstile);

	// always 200; requestCustomerOtp silently no-ops for an unknown email so membership never leaks
	await requestCustomerOtp(body.email, env);
	return { success: true };
});
