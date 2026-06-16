import { DBTicket, ensureCollegeDB } from 'hub:db:schema';

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
			current
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
