export default defineNuxtRouteMiddleware(async (to) => {
	const { isAuthenticated, fetchUser } = useAuth();

	await fetchUser();

	if (!isAuthenticated.value) {
		return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
	}
});
