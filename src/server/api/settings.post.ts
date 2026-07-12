import z from 'zod';

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
	'linkedin',
	'instagram',
	'patreon'
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

	// gate turning ai on behind a linked cloudflare account + a workers ai-capable token
	if (
		body.ai &&
		typeof body.ai === 'object' &&
		(body.ai as Record<string, unknown>).enabled === true
	) {
		const { capable, reason } = await aiCapability(env);
		if (!capable) {
			throw createError({
				statusCode: 422,
				message: reason || 'Cloudflare Workers AI is not available'
			});
		}
	}

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
		// seal the inbound poll password the same way; an empty/absent one keeps the sealed value
		const poll = email.poll as Record<string, unknown> | undefined;
		if (poll) {
			if (typeof poll.password === 'string' && poll.password.length > 0) {
				await sealEmailPollPassword(poll.password, env.MASTER_KEY);
			}
			const { password, ...pollWithoutPassword } = poll;
			void password;
			email.poll = pollWithoutPassword;
		}
		await setJsonSetting('email', email);
		// keep the canonical top-level supportEmail in sync with the transport's address
		const support = typeof email.support_email === 'string' ? email.support_email.trim() : '';
		if (support && typeof body.supportEmail !== 'string') {
			await setStringSetting('supportEmail', support);
		}
	}

	if (body.branding && typeof body.branding === 'object') {
		await setJsonSetting('branding', body.branding);
	}

	if (body.features && typeof body.features === 'object') {
		await setJsonSetting('features', body.features);
	}

	// default ticket visibility per creation source (guest / emailed / team)
	if (body.visibility && typeof body.visibility === 'object') {
		await setJsonSetting('visibility', body.visibility);
	}

	// feature config blocks persisted verbatim as json (no secrets among these)
	for (const key of [
		'retention',
		'audit',
		'locking',
		'automation',
		'ai',
		'role_icons',
		'role_colors',
		'avatars'
	] as const) {
		const value = body[key];
		if (value && typeof value === 'object') await setJsonSetting(key, value);
	}

	return await getAllSettings();
});
