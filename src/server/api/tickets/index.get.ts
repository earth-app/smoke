import type { DBTicket } from 'hub:db:schema';
import { ensureCollegeDB } from 'hub:db:schema';

export default defineEventHandler(async (event) => {
	try {
		const { search, page, limit, offset, sort, sort_direction } = query(event, [
			'title',
			'created_at',
			'updated_at',
			'description',
			'customer_id',
			'status',
			'priority',
			'labels',
			'assignees'
		]);

		// optional server-side filters; listTickets validates status tokens against the enum
		const raw = getQuery(event);
		const statusParam = typeof raw.status === 'string' ? raw.status : '';
		const statuses = statusParam
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const archivedRaw = typeof raw.archived === 'string' ? raw.archived : '';
		const archived: 'exclude' | 'only' | 'all' =
			archivedRaw === 'exclude' || archivedRaw === 'only' || archivedRaw === 'all'
				? archivedRaw
				: 'all';

		const env = event.context.cloudflare.env;
		ensureCollegeDB(env);
		const current = await getOptionalLoggedIn(event);

		return await listTickets(
			env,
			search,
			page,
			limit,
			offset,
			sort as keyof DBTicket,
			sort_direction,
			current,
			{ statuses, archived }
		);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to list tickets',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
