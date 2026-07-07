import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';

const querySchema = z.object({
	id: z.coerce.number().int().positive(),
	token: z.string().min(1)
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const { id, token } = querySchema.parse(getQuery(event));

	const expected = await hmacSha256(env.HMAC_SECRET, `status:${id}`);
	if (token !== expected) {
		throw createError({ statusCode: 403, message: 'Invalid Status Token' });
	}

	let thread;
	try {
		thread = await getTicketThread(id, env, null);
	} catch (error) {
		// a private ticket surfaces as a 403 from the thread gate; hide it as a 404
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			const status = Number((error as { statusCode?: number }).statusCode);
			if (status === 403) throw createError({ statusCode: 404, message: 'Ticket Not Found' });
		}
		throw error;
	}

	if (thread.ticket.private) {
		throw createError({ statusCode: 404, message: 'Ticket Not Found' });
	}

	const messages = thread.messages
		.filter((message) => !message.private)
		.map((message) => ({
			message: message.message,
			sender_kind: message.sender.kind,
			created_at: message.created_at
		}));

	return {
		id: thread.ticket.id,
		title: thread.ticket.title,
		status: thread.ticket.status,
		priority: thread.ticket.priority,
		created_at: thread.ticket.created_at,
		updated_at: thread.ticket.updated_at,
		messages
	};
});
