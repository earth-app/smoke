import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageTicket)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.customerIdParam }).parse
	);

	const customer = await getCustomerById(id, event.context.cloudflare.env);
	if (!customer) {
		throw createError({
			statusCode: 404,
			message: 'Customer not found',
			data: { param: id, success: false }
		});
	}

	return customer;
});
