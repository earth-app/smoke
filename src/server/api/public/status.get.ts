import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { TicketVisibility } from '~/shared/types/ticket';

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

	// the token is the credential, so it grants view access to a public or (unlisted) private
	// ticket; only staff-internal tickets stay hidden from the public routes
	const thread = await getTicketThread(id, env, null, { bypassGate: true });
	if (thread.ticket.visibility === TicketVisibility.Internal) {
		throw createError({ statusCode: 404, message: 'Ticket Not Found' });
	}

	// reuse the real TicketActor sender so the shared thread renders sender display (still hide private)
	const messages = thread.messages
		.filter((message) => !message.private)
		.map((message) => ({
			id: message.id,
			ticket_id: message.ticket_id,
			sender_id: message.sender_id,
			sender: message.sender,
			private: false as const,
			message: message.message,
			created_at: message.created_at
		}));

	// creator display for the header; null for guest / customer-less tickets
	const customer = thread.ticket.customer_id
		? await getCustomerById(thread.ticket.customer_id, env)
		: null;
	const creator = customer ? { name: customer.name, email: customer.email } : null;

	const locking = await getLockingSettings();

	return {
		id: thread.ticket.id,
		title: thread.ticket.title,
		description: thread.ticket.description,
		status: thread.ticket.status,
		priority: thread.ticket.priority,
		visibility: thread.ticket.visibility,
		color: thread.ticket.color ?? null,
		icon: thread.ticket.icon ?? null,
		created_at: thread.ticket.created_at,
		updated_at: thread.ticket.updated_at,
		locked: thread.ticket.locked === true,
		archived: thread.ticket.archived === true,
		archived_at: thread.ticket.archived_at ?? null,
		creator,
		// whether the customer may reopen a closed/archived request from this page
		can_reopen: locking.customer_reopen,
		// token holders always reply (as the owning customer); the reply endpoint enforces the lock
		can_reply: true,
		messages
	};
});
