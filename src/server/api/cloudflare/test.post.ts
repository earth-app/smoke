import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { Permission } from '~/shared/types/user';

const TOKEN_KEY = 'smoke:setting:cloudflare_token';

// tests a token passed in the body (before linking) or the stored token (after), and reports
// which features it can drive; used by the capability panel in setup + settings
const body = z.object({
	token: z.string().optional(),
	account_id: z.string().optional()
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);
	setMockCf(isMockCf(env));

	// gate: a logged-in staffer needs ManageSettings; unauthenticated is allowed ONLY during
	// first-run setup (no admin exists yet) so the wizard can test creds before the account is made
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

	if (!token) {
		return {
			valid: false,
			status: 'missing',
			scopes: [],
			capabilities: cloudflareCapabilities([])
		};
	}

	try {
		const verified = await verifyToken(token);
		const scopes = await getTokenScopes(token);
		const accountId = input.account_id?.trim() || (await getCloudflareSettings()).account_id || '';

		let zones: { id: string; name: string }[] = [];
		let accountOk: boolean | null = null;
		if (accountId) {
			try {
				zones = await listZones(token, accountId);
				accountOk = true;
			} catch {
				accountOk = false;
			}
		}

		return {
			valid: true,
			status: verified.status ?? 'active',
			scopes,
			capabilities: await probeCloudflareCapabilities(token, accountId, zones[0]?.id),
			account_id: accountId,
			account_ok: accountOk,
			zones
		};
	} catch (error) {
		return {
			valid: false,
			status: 'invalid',
			message: explainCfError(error),
			scopes: [],
			capabilities: cloudflareCapabilities([])
		};
	}
});
