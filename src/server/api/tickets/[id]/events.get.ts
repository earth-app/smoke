import z from 'zod';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);

	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.ticketIdParam }).parse
	);

	try {
		// gate on ticket visibility (getTicketById returns null when the viewer can't see it)
		const ticket = await getTicketById(id, event.context.cloudflare.env, current);
		if (!ticket) {
			throw createError({
				statusCode: 404,
				message: 'Ticket not found'
			});
		}

		return { events: await getTicketEvents(id) };
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to list ticket events',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
