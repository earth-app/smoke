import type { H3Event } from 'h3';

// cloudflare's documented turnstile test secret keys; short-circuited so dev/e2e never hit the network
const TEST_SECRET_ALWAYS_PASS = '1x0000000000000000000000000000000AA';
const TEST_SECRET_ALWAYS_FAIL = '2x0000000000000000000000000000000AA';
const TEST_SECRET_TOKEN_USED = '3x0000000000000000000000000000000AA';

function turnstileSecretKey(event: H3Event): string | undefined {
	try {
		return useRuntimeConfig(event)?.turnstile?.secretKey || undefined;
	} catch {
		return undefined;
	}
}

// which turnstile keys are present (public-safe booleans; never the secret value). a half-configured
// state (one key) leaves protection OFF and is worth surfacing distinctly in the ui
export function turnstileKeyStatus(event: H3Event): {
	hasSiteKey: boolean;
	hasSecretKey: boolean;
	configured: boolean;
} {
	try {
		const config = useRuntimeConfig(event);
		const hasSecretKey = !!config?.turnstile?.secretKey;
		const hasSiteKey = !!config?.public?.turnstile?.siteKey;
		return { hasSiteKey, hasSecretKey, configured: hasSiteKey && hasSecretKey };
	} catch {
		return { hasSiteKey: false, hasSecretKey: false, configured: false };
	}
}

// turnstile is auto-applied only when both keys are present; unconfigured is a no-op
export function isTurnstileConfigured(event: H3Event): boolean {
	return turnstileKeyStatus(event).configured;
}

// verify a turnstile token when configured; fail closed on a missing token or a verify outage
export async function verifyTurnstile(event: H3Event, token: string | undefined): Promise<void> {
	if (!isTurnstileConfigured(event)) return;
	if (!token) {
		throw createError({ statusCode: 400, message: 'Captcha verification required' });
	}

	// well-known cloudflare test keys resolve deterministically, no network call
	const secret = turnstileSecretKey(event);
	if (secret === TEST_SECRET_ALWAYS_PASS) return;
	if (secret === TEST_SECRET_ALWAYS_FAIL || secret === TEST_SECRET_TOKEN_USED) {
		throw createError({ statusCode: 403, message: 'Captcha verification failed' });
	}

	let ok = false;
	try {
		const result = await verifyTurnstileToken(token, event);
		ok = !!result?.success;
	} catch {
		// a verify outage fails closed, never bubbles up as a 500
		ok = false;
	}

	if (!ok) {
		throw createError({ statusCode: 403, message: 'Captcha verification failed' });
	}
}
