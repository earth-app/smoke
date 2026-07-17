import { ensureCollegeDB, ensureSchema } from 'hub:db:schema';
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

	// bust the cached setup-status so the middleware stops redirecting to /setup immediately
	await invalidateSetupStatus();
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
	'linkedin',
	'instagram',
	'patreon'
] as const;

const bodySchema = z.object({
	username: schemas.username,
	email: schemas.email,
	password: schemas.passwordParam,
	// optional admin avatar: an https url or an `icon:<name>` sentinel
	adminAvatar: z.string().max(256).optional(),
	firstName: z.string().max(64).optional(),
	lastName: z.string().max(64).optional(),
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
	await ensureSchema(env);

	const existing = await listUsers(env, '', 1, 1, 0, 'created_at', 'desc');
	if (existing.length > 0) {
		await sealSetup(event);
		throw createError({ statusCode: 409, message: 'Setup has already been completed' });
	}

	const body = await readValidatedBody(event, bodySchema.parse);

	const securityInput = (body.settings as Record<string, any> | undefined)?.security;
	if (securityInput && typeof securityInput === 'object') {
		await setJsonSetting('security', securityInput);
	}
	await getSecuritySettings();

	const { id, sessionToken } = await createUser(body.username, body.email, Role.Admin, env);

	// setting the password is the one non-recoverable step; if it throws, roll the admin back
	// so setup can be retried cleanly instead of bricking on the 409-already-exists path
	try {
		await setInitialPassword(id, body.password);
	} catch (error) {
		await deleteUser(id).catch(() => {});
		throw error;
	}

	// mark this account as the founding owner; its role + permissions are permanently locked
	await setOwnerUserId(id).catch(() => {});

	// optional real name for the admin (first name required if a last name is given)
	if (typeof body.firstName === 'string' && body.firstName.trim()) {
		try {
			const created = await getUserById(id, env);
			if (created) {
				await patchUser(
					created,
					{
						first_name: body.firstName.trim(),
						last_name:
							typeof body.lastName === 'string' && body.lastName.trim()
								? body.lastName.trim()
								: undefined
					},
					env
				);
			}
		} catch (error) {
			console.warn('setup: failed to set admin name', error);
		}
	}

	// optional settings; a failure here leaves a valid, loginable admin, so don't undo it
	try {
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
				// seal the inbound poll password the same way before persisting the poll config
				const poll = email.poll as Record<string, any> | undefined;
				if (poll) {
					if (poll.password) {
						await sealEmailPollPassword(String(poll.password), env.MASTER_KEY);
					}
					email.poll = { ...poll };
					delete email.poll.password;
				}
				await setJsonSetting('email', email);
				// mirror the support address into the canonical top-level setting so every
				// consumer (settings page, channel status, cf provisioning) reads it consistently
				const support = typeof email.support_email === 'string' ? email.support_email.trim() : '';
				if (support && typeof settings.supportEmail !== 'string') {
					await setStringSetting('supportEmail', support);
				}
			}
			if (settings.branding) await setJsonSetting('branding', settings.branding);
			for (const key of stringSettingKeys) {
				const value = settings[key];
				if (typeof value === 'string') await setStringSetting(key, value);
			}

			// feature config blocks from the wizard (no secrets among these)
			for (const key of [
				'retention',
				'locking',
				'automation',
				'ai',
				'role_icons',
				'role_colors',
				'avatars'
			] as const) {
				const value = (settings as Record<string, any>)[key];
				if (value && typeof value === 'object') await setJsonSetting(key, value);
			}

			// optional cloudflare link from the wizard; seal the token like the link route does
			const cf = (settings as Record<string, any>).cloudflare;
			if (cf && typeof cf === 'object' && cf.account_id && cf.token) {
				setMockCf(isMockCf(env));
				try {
					await verifyToken(String(cf.token));
					const sealed = await sealSecret(String(cf.token), env.MASTER_KEY);
					await kv.set('smoke:setting:cloudflare_token', JSON.stringify(sealed));
					await setJsonSetting('cloudflare', {
						account_id: String(cf.account_id),
						token_last4: last4(String(cf.token)),
						scopes: await getTokenScopes(String(cf.token))
					});
				} catch (cfError) {
					console.warn('setup: cloudflare link failed', cfError);
				}
			}
		}
	} catch (error) {
		console.warn('setup: failed to persist optional settings', error);
	}

	// optional admin avatar (icon: sentinel or https url); a failure leaves a valid admin
	if (typeof body.adminAvatar === 'string' && body.adminAvatar.trim()) {
		try {
			const created = await getUserById(id, env);
			if (created) await patchUser(created, { avatar_url: body.adminAvatar.trim() }, env);
		} catch (error) {
			console.warn('setup: failed to set admin avatar', error);
		}
	}

	await sealSetup(event);

	return { success: true, user_id: id, session_token: sessionToken };
});
