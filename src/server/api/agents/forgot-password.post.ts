import z from 'zod';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({ email: schemas.email });

// public: always 200; requestAgentPasswordReset silently no-ops for an unknown email
export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	const body = await readValidatedBody(event, bodySchema.parse);

	await requestAgentPasswordReset(body.email, env);
	return { success: true };
});
