import z from 'zod';
import type { TicketMessage } from '~/shared/types/ticket';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const { search, sort, sort_direction } = primitiveQuery(event, [
		'id',
		'message',
		'created_at',
		'sender_id',
		'reply_to'
	]);

	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.ticketIdParam }).parse
	);

	try {
		const current = await getOptionalLoggedIn(event);
		const ticket = await getTicketById(id, event.context.cloudflare.env, current);
		if (!ticket) {
			throw createError({
				statusCode: 404,
				message: 'Ticket not found'
			});
		}

		return await listTicketMessages(
			id,
			event.context.cloudflare.env,
			search,
			sort as keyof Omit<TicketMessage, 'attachments' | 'ticket_id' | 'sender'>,
			sort_direction,
			current
		);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to list ticket messages',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
