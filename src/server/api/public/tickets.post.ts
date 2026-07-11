import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({
	// email is optional; without it the customer tracks the ticket via the returned status link
	email: schemas.email.optional(),
	name: z.string().min(1).max(128).optional(),
	title: z.string().min(1).max(200),
	description: z.string().min(1).max(10_000)
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	// TODO turnstile
	const body = await readValidatedBody(event, bodySchema.parse);
	const email = body.email?.trim();

	// with an email we thread it (find/create the customer); without one it's an anonymous guest
	const customer = email
		? ((await getCustomerByEmail(email, env)) ??
			(await createCustomer({ email, name: body.name ?? email }, env)))
		: await createCustomer({ email: '', name: body.name ?? 'Guest' }, env);

	const ticket = await createTicket(
		{ title: body.title, description: body.description, customer_id: customer.id, source: 'guest' },
		env
	);

	// only open an email thread when there's an address to thread against
	if (email) await initEmailThread(ticket.id, body.title, email);

	const token = await hmacSha256(env.HMAC_SECRET, `status:${ticket.id}`);
	return { ticket_id: ticket.id, status_token: token };
});
