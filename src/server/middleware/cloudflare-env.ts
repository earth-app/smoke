import { db as hubDb } from 'hub:db';

export default defineEventHandler((event) => {
	const ctx = event.context as any;
	const base = ctx.cloudflare?.env ?? process.env;
	ctx.cloudflare = { ...(ctx.cloudflare ?? {}), env: { ...base, DB: base.DB ?? hubDb } };
});
