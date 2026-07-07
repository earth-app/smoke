import z from 'zod';
import { Permission } from '~/shared/types/user';

const TOKEN_KEY = 'smoke:setting:cloudflare_token';

const body = z.object({
	account_id: z.string().min(1),
	token: z.string().min(1)
});

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageSettings)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const env = event.context.cloudflare.env;
	setMockCf(isMockCf(env));

	const input = await readValidatedBody(event, body.parse);

	try {
		await verifyToken(input.token);
	} catch (error) {
		throw createError({ statusCode: 400, message: explainCfError(error) });
	}

	// seal the token so it never sits in kv as plaintext
	const sealed = await sealSecret(input.token, env.MASTER_KEY);
	await kv.set(TOKEN_KEY, JSON.stringify(sealed));

	const settings = {
		account_id: input.account_id,
		token_last4: last4(input.token),
		scopes: await getTokenScopes(input.token)
	};
	await setJsonSetting('cloudflare', settings);

	// redacted; never the token
	return settings;
});
