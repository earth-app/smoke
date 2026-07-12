import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { Permission } from '~/shared/types/user';

const TOKEN_KEY = 'smoke:setting:cloudflare_token';

// enables cloudflare email sending for the support domain and returns the dkim/spf/mx records
// to add (or auto-creates them when DNS: Edit is granted). used by the onboarding flow in
// setup + settings; mirrors cloudflare/test.post's first-run gate
const body = z.object({
	token: z.string().optional(),
	account_id: z.string().optional(),
	zone_id: z.string().optional(),
	auto_dns: z.boolean().optional()
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);
	setMockCf(isMockCf(env));

	// gate: a logged-in staffer needs ManageSettings; unauthenticated is allowed ONLY during
	// first-run setup (no admin exists yet) so the wizard can provision before the account is made
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

	// resolve the token: an explicit body token (setup wizard, before sealing) wins, then the
	// linked/sealed token, then an explicitly-set env token
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
			message: 'A Cloudflare zone is required to provision email sending'
		});
	}

	const support = (await getEmailSettings()).support_email || env.SUPPORT_EMAIL;
	if (!support) {
		throw createError({ statusCode: 400, message: 'No support address configured' });
	}
	const domain = String(support).split('@')[1] ?? '';
	if (!domain) {
		throw createError({ statusCode: 400, message: 'Support address is missing a domain' });
	}

	// auto-create the dns records when the token can edit dns, unless the caller overrides it
	const scopes = cf.scopes ?? (await getTokenScopes(token));
	const canDns = cloudflareCapabilities(scopes).some((c) => c.key === 'dns' && c.granted);
	const autoDns = input.auto_dns ?? canDns;

	let provision;
	try {
		provision = await provisionEmailSending(token, zoneId, domain, { autoDns });
	} catch (error) {
		throw createError({ statusCode: 422, message: explainCfError(error) });
	}

	// persist the zone + an email-sending marker so status can verify onboarding later
	await setJsonSetting('cloudflare', {
		...cf,
		zone_id: zoneId,
		email_sending: { domain, subdomain: provision.subdomain, enabled: provision.enabled }
	});

	const status = await emailConfigStatus(env);
	return { ...provision, status };
});
