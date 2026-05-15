import z from 'zod';
import { ensureLoggedIn, getTicketById, patchTicket } from '~/server/utils';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const user = await ensureLoggedIn(event);
	if (!user.permissions.includes(Permission.ManageTicket)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

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

	const body = await readValidatedBody(event, schemas.ticketPatchBody.parse);

	try {
		return await patchTicket(id, body, event.context.cloudflare.env);
	} catch (error) {
		throw createError({
			statusCode: 500,
			message: 'Failed to update ticket',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
