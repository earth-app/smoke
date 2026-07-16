import { ensureCollegeDB } from 'hub:db:schema';
import { Permission } from '~/shared/types/user';

const TOKEN_KEY = 'smoke:setting:cloudflare_token';

// worker scripts on the linked account, for the catch-all target dropdown in setup + settings.
// unauthenticated is allowed ONLY during first-run so the wizard can pick a worker pre-admin
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
		let userCount = 0;
		try {
			const users = await listUsers(env, '', 1, 1, 0, 'created_at', 'desc');
			userCount = users.length;
		} catch (error) {
			console.error('[cloudflare/workers] user count read failed; treating as first-run', error);
		}
		if (userCount > 0) {
			throw createError({ statusCode: 401, message: 'Authentication required' });
		}
	}

	const settings = await getCloudflareSettings();
	const sealed = await kv.get<any>(TOKEN_KEY, 'json').catch(() => null);
	const token = sealed ? await openSecret(sealed, env.MASTER_KEY).catch(() => '') : '';
	if (!token || !settings.account_id) {
		return { workers: [] };
	}

	try {
		const scripts = await listWorkerScripts(token, settings.account_id);
		return { workers: scripts.map((s) => ({ name: s.id })) };
	} catch {
		return { workers: [] };
	}
});
