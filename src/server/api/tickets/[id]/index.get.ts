import z from 'zod';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.ticketIdParam }).parse
	);
	const current = await getOptionalLoggedIn(event);
	const ticket = await getTicketById(id, event.context.cloudflare.env, current);

	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found',
			data: { param: id, success: false }
		});
	}

	return ticket;
});
