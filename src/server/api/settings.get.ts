export default defineEventHandler(async (event) => {
	const settings = await getAllSettings();
	// public-safe boolean only; never the secret
	return { ...settings, turnstile: { configured: isTurnstileConfigured(event) } };
});
