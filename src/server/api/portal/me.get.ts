export default defineEventHandler(async (event) => {
	const customer = await getOptionalCustomer(event);
	return { customer: customer ?? null };
});
