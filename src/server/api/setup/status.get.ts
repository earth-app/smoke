import { ensureCollegeDB } from 'hub:db:schema';

const SETUP_KV_KEY = 'smoke:setup_completed';
const SETUP_COOKIE = 'smoke_setup';

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const users = await listUsers(env, '', 1, 1, 0, 'created_at', 'desc');
	const userCount = users.length;

	let flagged = false;
	try {
		flagged = Boolean(await kv.get<string>(SETUP_KV_KEY));
	} catch {
		flagged = false;
	}

	// this browser already sealed setup; survives d1/kv read lag right after the first insert
	const sealed = Boolean(getCookie(event, SETUP_COOKIE));
	const needsSetup = userCount === 0 && !flagged && !sealed;

	return { needsSetup, userCount };
});
