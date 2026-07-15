// normalize a raw session token from a cookie/header/api response into a clean value or null
export function normalizeSessionToken(token: string | null | undefined): string | null {
	if (!token) return null;

	let normalized = token.trim();
	try {
		normalized = decodeURIComponent(normalized);
	} catch {
		// keep the raw token if it's not url encoded
	}

	if (normalized.length >= 2 && normalized.startsWith('"') && normalized.endsWith('"')) {
		normalized = normalized.slice(1, -1);
	}

	return normalized || null;
}
