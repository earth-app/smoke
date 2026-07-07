import { ensureSchema } from 'hub:db:schema';

// create the db tables on first request (no migration files ship for them); runs once
export default defineNitroPlugin((nitroApp) => {
	let pending: Promise<void> | null = null;

	nitroApp.hooks.hook('request', async (event) => {
		if (pending) return pending;
		// cloudflare preset populates the env; node preset (e2e preview) falls back to process.env
		const env = (event.context as any).cloudflare?.env ?? process.env;
		pending = ensureSchema(env).catch((error) => {
			console.warn('db schema ensure failed', error);
		});
		return pending;
	});
});
