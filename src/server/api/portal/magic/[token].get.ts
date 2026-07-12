import z from 'zod';

// public: exchange a portal magic-link token for a customer session cookie
export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	const { token } = await getValidatedRouterParams(
		event,
		z.object({ token: z.string().min(1).max(256) }).parse
	);

	const customerId = await consumeCustomerMagicLink(token, env);
	if (!customerId) {
		throw createError({ statusCode: 400, message: 'This access link is no longer valid' });
	}

	await startCustomerSession(event, customerId, env);
	return { ok: true };
});
