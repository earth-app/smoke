import z from 'zod';
import { getOptionalLoggedIn, getTicketMessage } from '~/server/utils';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const { id, messageId } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.ticketIdParam, messageId: schemas.ticketMessageIdParam }).parse
	);

	try {
		const current = await getOptionalLoggedIn(event);
		return await getTicketMessage(id, messageId, event.context.cloudflare.env, current);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to retrieve ticket message',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
