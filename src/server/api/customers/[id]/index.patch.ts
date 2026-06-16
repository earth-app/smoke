import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.customerIdParam }).parse
	);
	const body = await readValidatedBody(event, schemas.customerPatchBody.parse);

	if (body.name !== undefined && !current.permissions.includes(Permission.ChangeCustomerName)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to change customer names'
		});
	}

	if (body.tags !== undefined && !current.permissions.includes(Permission.ChangeCustomerTags)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to change customer tags'
		});
	}

	if (body.email !== undefined || body.avatar_url !== undefined) {
		if (!current.permissions.includes(Permission.ManageTicket)) {
			throw createError({
				statusCode: 403,
				message: 'You do not have permission to perform this action'
			});
		}
	}

	const customer = await getCustomerById(id, event.context.cloudflare.env);
	if (!customer) {
		throw createError({
			statusCode: 404,
			message: 'Customer not found',
			data: { param: id, success: false }
		});
	}

	try {
		return await patchCustomer(id, body, event.context.cloudflare.env);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to update customer',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
