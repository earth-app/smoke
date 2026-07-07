import z from 'zod';
import { Permission } from '~/shared/types/user';

const bodySchema = z.object({}).loose();

const STRING_KEYS = [
	'name',
	'description',
	'themeColor',
	'favicon',
	'faviconPng',
	'website',
	'supportEmail',
	'github',
	'twitter',
	'discord',
	'linkedin'
] as const;

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageSettings)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const env = event.context.cloudflare.env;
	const body = (await readValidatedBody(event, bodySchema.parse)) as Record<string, unknown>;

	for (const key of STRING_KEYS) {
		const value = body[key];
		if (typeof value === 'string') await setStringSetting(key, value);
	}

	if (body.email && typeof body.email === 'object') {
		const email = { ...(body.email as Record<string, unknown>) };
		const smtp = email.smtp as Record<string, unknown> | undefined;
		if (smtp && typeof smtp.password === 'string') {
			// never persist the smtp password as plaintext; seal it under the master key
			const sealed = await sealSecret(smtp.password, env.MASTER_KEY);
			await kv.set('smoke:setting:email_smtp_password', JSON.stringify(sealed));
			const { password, ...smtpWithoutPassword } = smtp;
			email.smtp = smtpWithoutPassword;
		}
		await setJsonSetting('email', email);
	}

	if (body.branding && typeof body.branding === 'object') {
		await setJsonSetting('branding', body.branding);
	}

	if (body.features && typeof body.features === 'object') {
		await setJsonSetting('features', body.features);
	}

	return await getAllSettings();
});
