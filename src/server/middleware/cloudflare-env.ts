// the node-server preset (e2e preview) has no cloudflare binding context; back env with
// process.env so routes reading event.context.cloudflare.env work. no-op under workerd.
export default defineEventHandler((event) => {
	const ctx = event.context as any;
	if (!ctx.cloudflare) ctx.cloudflare = { env: process.env };
	else if (!ctx.cloudflare.env) ctx.cloudflare.env = process.env;
});
