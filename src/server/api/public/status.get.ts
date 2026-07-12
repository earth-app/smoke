import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { TicketVisibility } from '~/shared/types/ticket';

const querySchema = z.object({
	id: z.coerce.number().int().positive(),
	// token is optional; an owning or participant customer session authorizes just the same
	token: z.string().min(1).optional()
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const { id, token } = querySchema.parse(getQuery(event));

	// two credentials grant view access: the per-ticket hmac status token (magic-link), or a
	// signed-in customer who owns or participates in the ticket
	const sessionCustomer = await getOptionalCustomer(event);
	const expected = await hmacSha256(env.HMAC_SECRET, `status:${id}`);
	const tokenOk = !!token && token === expected;

	// no token and no session -> reject without leaking whether the ticket exists
	if (!tokenOk && !sessionCustomer) {
		throw createError({ statusCode: 403, message: 'Invalid Status Token' });
	}

	// the credential grants view access to a public or (unlisted) private ticket; only staff-internal
	// tickets stay hidden from the public routes
	const thread = await getTicketThread(id, env, null, { bypassGate: true });

	// a session authorizes only for the owner or a participant of THIS ticket
	if (!tokenOk) {
		const sessionEmail = sessionCustomer?.email?.trim().toLowerCase();
		const isOwner = !!sessionCustomer && thread.ticket.customer_id === sessionCustomer.id;
		const isParticipant =
			!!sessionEmail && (thread.ticket.participants ?? []).includes(sessionEmail);
		if (!isOwner && !isParticipant) {
			throw createError({ statusCode: 403, message: 'Invalid Status Token' });
		}
	}

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

	// creator display for the header: a real customer, else the staff user who opened it
	const customer = thread.ticket.customer_id
		? await getCustomerById(thread.ticket.customer_id, env)
		: null;

	let creator: { name: string; email?: string; staff?: boolean } | null = null;
	if (customer) {
		creator = { name: customer.name ?? '', email: customer.email, staff: false };
	} else if (thread.ticket.created_by) {
		const staff = await getUserById(thread.ticket.created_by, env);
		if (staff) creator = { name: displayName(staff) || staff.username, staff: true };
	}

	const locking = await getLockingSettings();

	// field-change timeline for the public viewer; strip actor email/avatar so no internal contact leaks
	const events = (thread.events ?? []).map((e) => ({
		id: e.id,
		kind: e.kind,
		from: e.from,
		to: e.to,
		label: e.label,
		flow_name: e.flow_name,
		created_at: e.created_at,
		actor: e.actor
			? e.actor.kind === 'user'
				? {
						kind: 'user' as const,
						name: e.actor.name,
						username: e.actor.username,
						role: e.actor.role
					}
				: { kind: 'customer' as const, name: e.actor.name }
			: undefined
	}));

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
		// only a ticket with a real registered customer can be publicly replied to
		can_reply: !!customer,
		messages,
		events
	};
});
