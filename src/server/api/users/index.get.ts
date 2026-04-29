import type { DBUser } from 'hub:db:schema';
import { ensureCollegeDB } from 'hub:db:schema';
import { listUsers, query } from '~/server/utils';

export default defineEventHandler(async (event) => {
	const { search, page, limit, offset, sort, sort_direction } = query(event, [
		'username',
		'created_at'
	]);
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	try {
		return await listUsers(env, search, page, limit, offset, sort as keyof DBUser, sort_direction);
	} catch (error) {
		throw createError({
			statusCode: 500,
			message: 'Failed to list users',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
