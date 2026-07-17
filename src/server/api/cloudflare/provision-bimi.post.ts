import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { Permission } from '~/shared/types/user';

const TOKEN_KEY = 'smoke:setting:cloudflare_token';

// publishes the default._bimi dns record pointing at /bimi/logo.svg and reports dmarc enforcement.
// mirrors provision-email's token/zone/domain resolution + first-run gate. auto_dmarc (opt-in) adds a
// safe enforcing dmarc record only when the domain has none (never downgrades an existing policy)
const body = z.object({
	token: z.string().optional(),
	account_id: z.string().optional(),
	zone_id: z.string().optional(),
	auto_dmarc: z.boolean().optional()
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);
	setMockCf(isMockCf(env));

	const current = await getOptionalLoggedIn(event);
	if (current) {
		if (!current.permissions.includes(Permission.ManageSettings)) {
			throw createError({
				statusCode: 403,
				message: 'You do not have permission to perform this action'
			});
		}
	} else {
		const users = await listUsers(env, '', 1, 1, 0, 'created_at', 'desc');
		if (users.length > 0) {
			throw createError({ statusCode: 401, message: 'Authentication required' });
		}
	}

	const input = await readValidatedBody(event, body.parse);

	let token = input.token?.trim();
	if (!token) {
		const sealed = await kv.get<any>(TOKEN_KEY, 'json').catch(() => null);
		token = sealed ? await openSecret(sealed, env.MASTER_KEY).catch(() => '') : '';
	}
	if (!token) token = cloudflareApiToken(env);
	if (!token) {
		throw createError({ statusCode: 400, message: 'Cloudflare account is not linked' });
	}

	const cf = await getCloudflareSettings();
	const zoneId = input.zone_id?.trim() || cf.zone_id;
	if (!zoneId) {
		throw createError({
			statusCode: 400,
			message: 'A Cloudflare zone is required to provision BIMI'
		});
	}

	const email = await getEmailSettings();
	const support = email.support_email || env.SUPPORT_EMAIL;
	if (!support) {
		throw createError({ statusCode: 400, message: 'No support address configured' });
	}
	const domain = String(support).split('@')[1] ?? '';
	if (!domain) {
		throw createError({ statusCode: 400, message: 'Support address is missing a domain' });
	}

	const rawSite = (email as any).site_url || env.NUXT_PUBLIC_SITE_URL || `https://${domain}`;
	const logoUrl = `${String(rawSite).replace(/\/$/, '')}/bimi/logo.svg`;

	let provision;
	try {
		provision = await provisionBimi(token, zoneId, domain, logoUrl, {
			autoDmarc: input.auto_dmarc === true
		});
	} catch (error) {
		throw createError({ statusCode: 422, message: explainCfError(error) });
	}

	// persist the zone so status can read it back later
	await setJsonSetting('cloudflare', { ...cf, zone_id: zoneId });

	return provision;
});
