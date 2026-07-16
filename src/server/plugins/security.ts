export default defineNitroPlugin((nitroApp) => {
	let pending: Promise<void> | null = null;

	nitroApp.hooks.hook('request', () => {
		if (pending) return pending;
		pending = getSecuritySettings()
			.then(() => {})
			.catch((error) => {
				console.error('[security] failed to sync pbkdf2 iterations', error);
			});
		return pending;
	});
});
