import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({
	email: schemas.email,
	note: z.string().max(2000).optional()
});

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.AddEmail)) {
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
	const email = body.email.trim().toLowerCase();
	const { added, participants } = await addTicketParticipant(id, email, env, {
		actorId: current.id
	});

	// only invite + note when the email was actually added (not the owner / already present)
	if (added) {
		const summary = ticket.description.slice(0, 2000);
		await sendTicketAccessInvite(id, email, ticket.title, summary, env, body.note).catch(
			(error: unknown) => console.warn('Failed to send ticket access invite', error)
		);

		// internal note so staff see who was forwarded the ticket
		await addTicketMessage(
			id,
			{
				message: `Forwarded to ${email}${body.note ? `\n\nNote: ${body.note}` : ''}`,
				sender: {
					kind: 'user',
					id: current.id,
					username: current.username,
					email: current.email,
					name: current.name,
					avatar_url: current.avatar_url,
					role: current.role
				},
				private: true
			},
			env
		).catch((error: unknown) => console.warn('Failed to post participant note', error));
	}

	return { participants };
});
