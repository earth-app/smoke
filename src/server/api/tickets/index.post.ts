import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.CreateTicket)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const body = await readValidatedBody(event, schemas.ticketCreateBody.parse);
	if (body.private && !current.permissions.includes(Permission.TogglePrivate)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to mark tickets as private'
		});
	}

	try {
		// staff-created tickets default to the 'team' source visibility unless one is set explicitly;
		// stamp the creator so a customer-less ticket is attributed to the agent, not "Guest"
		return await createTicket(
			{ ...body, source: body.source ?? 'team', created_by: current.id } as Parameters<
				typeof createTicket
			>[0],
			event.context.cloudflare.env,
			{ actorId: current.id }
		);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to create ticket',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
