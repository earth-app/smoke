import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({
	extraContext: z.string().max(4000).optional()
});

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
	const body = await readValidatedBody(event, bodySchema.parse);
	const env = event.context.cloudflare.env;

	const ticket = await getTicketById(id, env, current);
	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found'
		});
	}

	if (!(await isAiEnabled(env))) {
		throw createError({
			statusCode: 400,
			message: 'AI Replies are Not Enabled'
		});
	}

	const thread = await getTicketThread(id, env, current);
	const history = thread.messages
		.filter((message) => message.message?.trim())
		.map((message) => ({
			role: message.sender.kind === 'customer' ? ('customer' as const) : ('agent' as const),
			content: message.message
		}));

	const result = await generateAiReply({ ticket, history, extraContext: body.extraContext }, env);
	if (!result) {
		throw createError({
			statusCode: 502,
			message: 'Failed to generate an AI reply'
		});
	}

	return { text: result.text, model: result.model };
});
