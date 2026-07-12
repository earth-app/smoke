export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;

	const customer = await getOptionalCustomer(event);
	if (!customer) {
		throw createError({ statusCode: 401, message: 'Not Signed In' });
	}

	const tickets = await listTicketsByCustomer(customer.id, env);
	return { tickets };
});
