import { ensureCollegeDB } from 'hub:db:schema';
import { listTickets } from '~/server/utils';

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	try {
		return await listTickets(env);
	} catch (error) {
		throw createError({
			statusCode: 500,
			message: 'Failed to list tickets',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
