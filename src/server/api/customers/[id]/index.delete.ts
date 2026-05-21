import z from 'zod';
import { deleteCustomer, ensureLoggedIn, getCustomerById } from '~/server/utils';
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

	try {
		await deleteCustomer(id, event.context.cloudflare.env);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to delete customer',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}

	return sendNoContent(event);
});
