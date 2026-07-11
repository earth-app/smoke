import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { TicketVisibility } from '~/shared/types/ticket';

const querySchema = z.object({
	q: z.string().max(120).optional(),
	limit: z.coerce.number().int().min(1).max(50).optional(),
	// archived requests are their own category; unset = normal (non-archived) results only
	archived: z.union([z.string(), z.boolean()]).optional()
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const { q, limit, archived } = querySchema.parse(getQuery(event));
	// no query = browse the most recent public tickets; a query filters them
	const search = (q || '').trim();
	const wantArchived = archived === true || archived === '1' || archived === 'true';

	// passing current=null makes listTickets add `private = 0`, so only public tickets are scanned;
	// the explicit visibility filter guards against a shared list-cache entry that predates this call
	const tickets = await listTickets(env, search, 1, limit ?? 20, 0, 'updated_at', 'desc', null);
	// archived is orthogonal to visibility, so split it into its own searchable category here
	const publicTickets = tickets.filter(
		(ticket) =>
			ticket.visibility === TicketVisibility.Public &&
			(wantArchived ? ticket.archived === true : ticket.archived !== true)
	);

	const results = await Promise.all(
		publicTickets.map(async (ticket) => ({
			id: ticket.id,
			title: ticket.title,
			status: ticket.status,
			archived: ticket.archived === true,
			created_at: ticket.created_at,
			token: await hmacSha256(env.HMAC_SECRET, `status:${ticket.id}`)
		}))
	);

	return { results };
});
