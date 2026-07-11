import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { TicketVisibility } from '~/shared/types/ticket';

const bodySchema = z.object({
	id: z.coerce.number().int().positive(),
	// token is optional; a verified customer session that owns the ticket authorizes just the same
	token: z.string().min(1).optional(),
	message: z.string().min(1).max(10_000)
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const body = await readValidatedBody(event, bodySchema.parse);

	// two credentials authorize a public reply: the per-ticket hmac status token (magic-link),
	// or a signed-in customer session that owns the ticket
	const sessionCustomer = await getOptionalCustomer(event);
	const expected = await hmacSha256(env.HMAC_SECRET, `status:${body.id}`);
	const tokenOk = !!body.token && body.token === expected;

	// no token and no session -> reject without leaking whether the ticket exists
	if (!tokenOk && !sessionCustomer) {
		throw createError({ statusCode: 403, message: 'Invalid Status Token' });
	}

	// only staff-internal tickets are hidden from the public routes
	const thread = await getTicketThread(body.id, env, null, { bypassGate: true });

	// an owning customer session is always allowed to reply
	const ownsViaSession = !!sessionCustomer && thread.ticket.customer_id === sessionCustomer.id;

	// otherwise we rely on the magic-link token; it must be valid AND the ticket must have a real
	// registered customer - guest/customer-less tickets have no one to reply as
	if (!ownsViaSession) {
		if (!tokenOk) {
			throw createError({ statusCode: 403, message: 'Invalid Status Token' });
		}
		const hasCustomer =
			thread.ticket.customer_id > 0 && !!(await getCustomerById(thread.ticket.customer_id, env));
		if (!hasCustomer) {
			throw createError({
				statusCode: 403,
				message: 'This ticket has no registered customer to reply as'
			});
		}
	}

	if (thread.ticket.visibility === TicketVisibility.Internal) {
		throw createError({ statusCode: 404, message: 'Ticket Not Found' });
	}

	// a locked thread is read-only for customers
	if (thread.ticket.locked) {
		throw createError({ statusCode: 423, message: 'This Thread is Locked' });
	}

	// an archived thread is read-only until it is unarchived
	if (thread.ticket.archived) {
		throw createError({ statusCode: 423, message: 'This Request is Archived' });
	}

	// post as the ticket's customer; prefer the signed-in customer's decrypted identity
	const customer = sessionCustomer ?? (await getCustomerById(thread.ticket.customer_id, env));
	const message = await addTicketMessage(
		body.id,
		{
			message: body.message,
			sender: {
				kind: 'customer',
				id: thread.ticket.customer_id,
				email: customer?.email || undefined,
				name: customer?.name
			}
		},
		env
	);

	return {
		id: message.id,
		message: message.message,
		sender_kind: message.sender.kind,
		created_at: message.created_at
	};
});
