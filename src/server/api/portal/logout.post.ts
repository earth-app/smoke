export default defineEventHandler(async (event) => {
	await logoutCustomer(event);
	return { success: true };
});
