export default defineNuxtRouteMiddleware(async (to) => {
	const { isAuthenticated, isAgent, fetchUser } = useAuth();

	await fetchUser();

	if (!isAuthenticated.value) {
		return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
	}

	if (!isAgent.value) {
		return abortNavigation(createError({ statusCode: 403, statusMessage: 'Forbidden' }));
	}
});
