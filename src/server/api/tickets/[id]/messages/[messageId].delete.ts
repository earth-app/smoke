import z from 'zod';
import { deleteTicketMessage, ensureLoggedIn, getTicketMessage } from '~/server/utils';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);

	const { id, messageId } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.ticketIdParam, messageId: schemas.ticketMessageIdParam }).parse
	);

	try {
		const message = await getTicketMessage(id, messageId, event.context.cloudflare.env);
		if (
			message.sender.id !== current.id &&
			!current.permissions.includes(Permission.ManageTicketMessages)
		) {
			throw createError({
				statusCode: 403,
				message: 'You do not have permission to perform this action'
			});
		}

		await deleteTicketMessage(id, messageId, event.context.cloudflare.env);
	} catch (error) {
		throw createError({
			statusCode: 500,
			message: 'Failed to delete ticket message',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}

	return sendNoContent(event);
});
