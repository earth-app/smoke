import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({ archived: z.boolean() });

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageTicket)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.ticketIdParam }).parse
	);
	const body = await readValidatedBody(event, bodySchema.parse);

	const env = event.context.cloudflare.env;
	const ticket = await getTicketById(id, env, current);
	if (!ticket) {
		throw createError({ statusCode: 404, message: 'Ticket not found' });
	}

	return await patchTicket(id, { archived: body.archived }, env, { actorId: current.id });
});
