import type { Customer } from '~/shared/types/user';
import { Permission } from '~/shared/types/user';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageTicket)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const { search, page, limit, offset, sort, sort_direction } = query(event, [
		'id',
		'name',
		'email',
		'avatar_url',
		'created_at',
		'updated_at'
	]);

	try {
		return await listCustomers(
			event.context.cloudflare.env,
			search,
			page,
			limit,
			offset,
			sort as keyof Customer,
			sort_direction
		);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to list customers',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
