export default defineNitroPlugin((nitro) => {
	nitro.hooks.hook('cloudflare:email', async ({ message, env, context }) => {
		// TODO handle email and add to ticket
	});
});
