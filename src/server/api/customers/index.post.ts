import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageCustomers)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const body = await readValidatedBody(event, schemas.customerCreateBody.parse);

	try {
		// createCustomer records the customer.created audit row with this actor
		return await createCustomer(
			body as Parameters<typeof createCustomer>[0],
			event.context.cloudflare.env,
			{ id: current.id, name: current.name || current.username }
		);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to create customer',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
