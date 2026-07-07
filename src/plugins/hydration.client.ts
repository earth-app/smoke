export default defineNuxtPlugin((nuxtApp) => {
	if (!useRuntimeConfig().public.e2e) return;
	nuxtApp.hook('app:mounted', () => {
		document.documentElement.dataset.hydrated = 'true';
	});
});
