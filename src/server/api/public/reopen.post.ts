import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { TicketStatus, TicketVisibility } from '~/shared/types/ticket';

const bodySchema = z.object({
	id: z.coerce.number().int().positive(),
	// token is optional; a verified customer session that owns the ticket authorizes just the same
	token: z.string().min(1).optional(),
	turnstile: z.string().max(4096).optional()
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const body = await readValidatedBody(event, bodySchema.parse);

	// captcha gate first (no-op unless turnstile is configured)
	await verifyTurnstile(event, body.turnstile);

	// two credentials authorize a reopen: the per-ticket hmac status token (magic-link),
	// or a signed-in customer session that owns the ticket
	const sessionCustomer = await getOptionalCustomer(event);
	const expected = await hmacSha256(env.HMAC_SECRET, `status:${body.id}`);
	const tokenOk = !!body.token && body.token === expected;

	// no token and no session -> reject without leaking whether the ticket exists
	if (!tokenOk && !sessionCustomer) {
		throw createError({ statusCode: 403, message: 'Invalid Status Token' });
	}

	// only staff-internal tickets stay hidden from public routes
	const thread = await getTicketThread(body.id, env, null, { bypassGate: true });

	// fail-closed authorization: owning session, or valid token to a ticket with a real customer
	await authorizePublicTicketWrite({ tokenOk, sessionCustomer, ticket: thread.ticket, env });

	if (thread.ticket.visibility === TicketVisibility.Internal) {
		throw createError({ statusCode: 404, message: 'Ticket Not Found' });
	}

	const locking = await getLockingSettings();
	if (!locking.customer_reopen) {
		throw createError({ statusCode: 403, message: 'Reopening is Disabled' });
	}

	// reopening unlocks + unarchives so the customer can reply again
	const updated = await patchTicket(
		body.id,
		{ status: TicketStatus.Open, archived: false, locked: false },
		env
	);

	return { id: updated.id, status: updated.status };
});
