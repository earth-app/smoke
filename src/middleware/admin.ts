import { Permission } from '~/shared/types/user';

export default defineNuxtRouteMiddleware(async (to) => {
	const { isAuthenticated, isAdmin, fetchUser } = useAuth();
	const { can } = useAuth();

	await fetchUser();

	if (!isAuthenticated.value) {
		return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
	}

	if (!isAdmin.value && !can(Permission.ManageSettings)) {
		return navigateTo('/dashboard');
	}
});
