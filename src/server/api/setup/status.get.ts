import { ensureCollegeDB } from 'hub:db:schema';

const SETUP_KV_KEY = 'smoke:setup_completed';
const SETUP_COOKIE = 'smoke_setup';

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;

	const { userCount, flagged } = await cache(
		SETUP_STATUS_KEY,
		async () => {
			let count = 0;
			try {
				ensureCollegeDB(env);
				const users = await listUsers(env, '', 1, 1, 0, 'created_at', 'desc');
				count = users.length;
			} catch (error) {
				console.error('[setup/status] user count read failed; assuming setup is needed', error);
				count = 0;
			}
			let flag = false;
			try {
				flag = Boolean(await kv.get<string>(SETUP_KV_KEY));
			} catch {
				flag = false;
			}
			return { userCount: count, flagged: flag };
		},
		30
	);

	// this browser already sealed setup; survives d1/kv read lag right after the first insert
	const sealed = Boolean(getCookie(event, SETUP_COOKIE));
	const needsSetup = userCount === 0 && !flagged && !sealed;

	return { needsSetup, userCount };
});
