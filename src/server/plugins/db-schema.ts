import { db as hubDb } from 'hub:db';
import { ensureSchema } from 'hub:db:schema';

// create the db tables on first request (no migration files ship for them); runs once
export default defineNitroPlugin((nitroApp) => {
	let pending: Promise<void> | null = null;

	nitroApp.hooks.hook('request', async (event) => {
		if (pending) return pending;
		const base = (event.context as any).cloudflare?.env ?? process.env;
		const env = { ...base, DB: base.DB ?? hubDb };

		pending = ensureSchema(env).catch((error) => {
			console.error('[db-schema] ensureSchema failed on first request', error);
		});
		return pending;
	});
});
