export default defineEventHandler(async (event) => {
	const settings = await getAllSettings();
	// public-safe booleans only; never the secret value
	return { ...settings, turnstile: turnstileKeyStatus(event) };
});
