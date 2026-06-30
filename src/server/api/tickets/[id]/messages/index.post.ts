import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ReplyTicket)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.ticketIdParam }).parse
	);
	const body = await readValidatedBody(event, schemas.ticketMessageCreateBody.parse);
	const ticket = await getTicketById(id, event.context.cloudflare.env, current);
	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found'
		});
	}

	try {
		const created = await addTicketMessage(
			id,
			{
				message: body.message,
				reply_to: body.reply_to,
				sender: {
					kind: 'user',
					id: current.id,
					username: current.username,
					email: current.email,
					name: current.name,
					avatar_url: current.avatar_url
				},
				attachments: body.attachments
			},
			event.context.cloudflare.env
		);

		// mirror the reply to the customer over email when the ticket is an email thread
		await sendTicketEmailReply(
			id,
			body.message,
			event.context.cloudflare.env,
			body.attachments
		).catch((error: unknown) => console.warn('Failed to send ticket email reply', error));

		return created;
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to add ticket message',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
