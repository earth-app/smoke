import z from 'zod';
import { getTicketById } from '~/server/utils';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.ticketIdParam }).parse
	);
	const ticket = await getTicketById(id, event.context.cloudflare.env);

	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found',
			data: { param: id, success: false }
		});
	}

	return ticket;
});
