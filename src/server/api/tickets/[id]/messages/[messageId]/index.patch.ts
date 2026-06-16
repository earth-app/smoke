import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);

	const { id, messageId } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.ticketIdParam, messageId: schemas.ticketMessageIdParam }).parse
	);
	const body = await readValidatedBody(
		event,
		z.object({
			message: schemas.ticketMessageCreateBody.shape.message,
			attachments: schemas.ticketMessageCreateBody.shape.attachments
		}).parse
	);

	try {
		const message = await getTicketMessage(id, messageId, event.context.cloudflare.env, current);
		if (message.sender.kind === 'user' && message.sender.id === current.id) {
		} else if (!current.permissions.includes(Permission.ManageTicketMessages)) {
			throw createError({
				statusCode: 403,
				message: 'You do not have permission to perform this action'
			});
		}

		return await editTicketMessage(
			id,
			messageId,
			body.message,
			body.attachments,
			event.context.cloudflare.env
		);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to update ticket message',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
