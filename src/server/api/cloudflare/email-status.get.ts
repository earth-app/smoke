import { ensureCollegeDB } from 'hub:db:schema';
import { Permission } from '~/shared/types/user';

// honest email-channel status the settings/setup ui trusts (configured vs needsOnboarding vs
// not configured). mirrors the first-run gate so the setup wizard can read it before an admin exists
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

	return await emailConfigStatus(env);
});
