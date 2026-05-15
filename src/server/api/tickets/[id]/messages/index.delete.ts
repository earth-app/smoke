import z from 'zod';
import { clearTicketMessages, ensureLoggedIn } from '~/server/utils';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageTicketMessages)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.ticketIdParam }).parse
	);

	try {
		await clearTicketMessages(id, event.context.cloudflare.env);
	} catch (error) {
		throw createError({
			statusCode: 500,
			message: 'Failed to clear ticket messages',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}

	return sendNoContent(event);
});
