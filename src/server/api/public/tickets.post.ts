import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({
	email: schemas.email,
	name: z.string().min(1).max(128).optional(),
	title: z.string().min(1).max(200),
	description: z.string().min(1).max(10_000)
});

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	// TODO turnstile
	const body = await readValidatedBody(event, bodySchema.parse);

	// email is optional to the flow; a ticket is created regardless of transport config
	const customer =
		(await getCustomerByEmail(body.email, env)) ??
		(await createCustomer({ email: body.email, name: body.name ?? body.email }, env));

	const ticket = await createTicket(
		{ title: body.title, description: body.description, customer_id: customer.id },
		env
	);

	await initEmailThread(ticket.id, body.title, body.email);

	const token = await hmacSha256(env.HMAC_SECRET, `status:${ticket.id}`);
	return { ticket_id: ticket.id, status_token: token };
});
