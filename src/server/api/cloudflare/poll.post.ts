import { ensureCollegeDB } from 'hub:db:schema';
import { Permission } from '~/shared/types/user';

// on-demand trigger for the imap/pop3 inbound poll (also runnable via the scheduled task)
export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageSettings)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);
	return await pollInboundMailbox(env);
});
