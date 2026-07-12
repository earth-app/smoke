import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({ email: z.string().min(1) });

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.RemoveEmail)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.ticketIdParam }).parse
	);

	const env = event.context.cloudflare.env;
	const ticket = await getTicketById(id, env, current);
	if (!ticket) {
		throw createError({ statusCode: 404, message: 'Ticket not found' });
	}

	const body = await readValidatedBody(event, bodySchema.parse);
	const { participants } = await removeTicketParticipant(id, body.email, env, {
		actorId: current.id
	});

	return { participants };
});
