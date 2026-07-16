export default defineNuxtRouteMiddleware(async (to) => {
	if (to.path.startsWith('/api')) return;

	const { ensure } = useSetupStatus();
	const status = await ensure();

	const needsSetup = status ? status.needsSetup : true;

	if (needsSetup && to.path !== '/setup') {
		return navigateTo('/setup');
	}
	if (status && !status.needsSetup && to.path === '/setup') {
		return navigateTo('/');
	}
});
