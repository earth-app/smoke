import z from 'zod';
import { ensureLoggedIn, listTicketMessages } from '~/server/utils';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	await ensureLoggedIn(event);
	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.ticketIdParam }).parse
	);

	try {
		return await listTicketMessages(id, event.context.cloudflare.env);
	} catch (error) {
		throw createError({
			statusCode: 500,
			message: 'Failed to list ticket messages',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
