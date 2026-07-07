import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { Role } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

const SETUP_KV_KEY = 'smoke:setup_completed';
const SETUP_COOKIE = 'smoke_setup';
const SETUP_COOKIE_OPTS = { path: '/', maxAge: 31536000, sameSite: 'lax' as const };

// mark setup done in kv (server truth) + a cookie (instant read-your-writes for this browser)
async function sealSetup(event: Parameters<typeof setCookie>[0]) {
	await kv.set(SETUP_KV_KEY, '1');
	setCookie(event, SETUP_COOKIE, '1', SETUP_COOKIE_OPTS);
}

const emailSettings = z.object({}).loose().optional();
const stringSettingKeys = [
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

const bodySchema = z.object({
	username: schemas.username,
	email: schemas.email,
	password: schemas.passwordParam,
	settings: z
		.object({
			email: emailSettings,
			branding: z.object({}).loose().optional(),
			name: z.string().optional(),
			description: z.string().optional(),
			themeColor: z.string().optional(),
			favicon: z.string().optional(),
			faviconPng: z.string().optional(),
			website: z.string().optional(),
			supportEmail: z.string().optional(),
			github: z.string().optional(),
			twitter: z.string().optional(),
			discord: z.string().optional(),
			linkedin: z.string().optional()
		})
		.loose()
		.optional()
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const existing = await listUsers(env, '', 1, 1, 0, 'created_at', 'desc');
	if (existing.length > 0) {
		await sealSetup(event);
		throw createError({ statusCode: 409, message: 'Setup has already been completed' });
	}

	const body = await readValidatedBody(event, bodySchema.parse);

	const { id, sessionToken } = await createUser(body.username, body.email, Role.Admin, env);
	await setInitialPassword(id, body.password);

	const settings = body.settings;
	if (settings) {
		if (settings.email) {
			// seal a custom smtp password out of the public email blob before persisting
			const email = { ...(settings.email as Record<string, any>) };
			const smtp = email.smtp as Record<string, any> | undefined;
			if (smtp?.password) {
				const sealed = await sealSecret(String(smtp.password), env.MASTER_KEY);
				await kv.set('smoke:setting:email_smtp_password', JSON.stringify(sealed));
				email.smtp = { ...smtp };
				delete email.smtp.password;
			}
			await setJsonSetting('email', email);
		}
		if (settings.branding) await setJsonSetting('branding', settings.branding);
		for (const key of stringSettingKeys) {
			const value = settings[key];
			if (typeof value === 'string') await setStringSetting(key, value);
		}
	}

	await sealSetup(event);

	return { success: true, user_id: id, session_token: sessionToken };
});
