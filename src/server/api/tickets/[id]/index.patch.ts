import z from 'zod';
import { Permission } from '~/shared/types/user';
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
	const ticket = await getTicketById(id, event.context.cloudflare.env, user);

	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found',
			data: { param: id, success: false }
		});
	}

	const body = await readValidatedBody(event, schemas.ticketPatchBody.parse);

	// archived is read-only; the only edit allowed is unarchiving (a body that ONLY sets archived: false)
	if (ticket.archived) {
		const keys = Object.keys(body).filter(
			(key) => (body as Record<string, unknown>)[key] !== undefined
		);
		const unarchiveOnly = keys.length === 1 && keys[0] === 'archived' && body.archived === false;
		if (!unarchiveOnly) {
			throw createError({
				statusCode: 423,
				message: 'Unarchive this ticket before editing it.'
			});
		}
	}

	try {
		return await patchTicket(
			id,
			body as Parameters<typeof patchTicket>[1],
			event.context.cloudflare.env,
			{ actorId: user.id }
		);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to update ticket',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
