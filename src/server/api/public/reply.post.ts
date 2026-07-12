import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { TicketVisibility } from '~/shared/types/ticket';

const bodySchema = z.object({
	id: z.coerce.number().int().positive(),
	// token is optional; a verified customer session that owns the ticket authorizes just the same
	token: z.string().min(1).optional(),
	message: z.string().min(1).max(10_000),
	turnstile: z.string().max(4096).optional()
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const body = await readValidatedBody(event, bodySchema.parse);

	// captcha gate first (no-op unless turnstile is configured)
	await verifyTurnstile(event, body.turnstile);

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

	// fail-closed authorization: owning session, or valid token to a ticket with a real customer
	await authorizePublicTicketWrite({ tokenOk, sessionCustomer, ticket: thread.ticket, env });

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

	// a signed-in participant (cc'd / forwarded, not the owner) posts as THEMSELVES; otherwise the
	// message is attributed to the ticket's owning customer (token or owner-session path)
	const sessionEmail = sessionCustomer?.email?.trim().toLowerCase();
	const isParticipant =
		!!sessionCustomer &&
		sessionCustomer.id !== thread.ticket.customer_id &&
		!!sessionEmail &&
		(thread.ticket.participants ?? []).includes(sessionEmail);

	let sender;
	if (isParticipant && sessionCustomer) {
		sender = {
			kind: 'customer' as const,
			id: sessionCustomer.id,
			email: sessionCustomer.email || undefined,
			name: sessionCustomer.name
		};
	} else {
		const customer = sessionCustomer ?? (await getCustomerById(thread.ticket.customer_id, env));
		sender = {
			kind: 'customer' as const,
			id: thread.ticket.customer_id,
			email: customer?.email || undefined,
			name: customer?.name
		};
	}

	const message = await addTicketMessage(body.id, { message: body.message, sender }, env);

	return {
		id: message.id,
		message: message.message,
		sender_kind: message.sender.kind,
		created_at: message.created_at
	};
});
