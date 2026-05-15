import { createTicket, ensureLoggedIn } from '~/server/utils';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const user = await ensureLoggedIn(event);

	if (!user.permissions.includes(Permission.CreateTicket)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const body = await readValidatedBody(event, schemas.ticketCreateBody.parse);

	try {
		return await createTicket(body, event.context.cloudflare.env);
	} catch (error) {
		throw createError({
			statusCode: 500,
			message: 'Failed to create ticket',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
