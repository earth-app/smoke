// reason phrases that carry no useful detail; prefer the real message or a fallback
const GENERIC_STATUS = new Set([
	'error',
	'unknown error',
	'bad request',
	'server error',
	'internal server error'
]);

// h3 stringifies a thrown ZodError as a raw json array; pull out the first issue as a sentence
function unwrapZodIssues(text: string): string | null {
	if (!text.trim().startsWith('[')) return null;
	try {
		const issues = JSON.parse(text);
		if (!Array.isArray(issues) || !issues.length) return null;
		const first = issues[0];
		if (!first || typeof first.message !== 'string') return null;
		const field = Array.isArray(first.path) ? first.path.filter(Boolean).join('.') : '';
		const label = field ? field.charAt(0).toUpperCase() + field.slice(1) : '';
		return label ? `${label}: ${first.message}` : first.message;
	} catch {
		return null;
	}
}

function usable(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed || GENERIC_STATUS.has(trimmed.toLowerCase())) return null;
	// a raw zod-error json blob becomes a clean "Field: message" sentence
	return unwrapZodIssues(trimmed) ?? trimmed;
}

export function extractServerMessage(
	error: unknown,
	fallback = 'Something went wrong. Please try again.'
): string {
	const err = error as any;
	const data = err?.data;

	const candidates = [
		data?.issues?.[0]?.message,
		data?.data?.message,
		data?.message,
		data?.statusMessage,
		err?.statusMessage
	];
	for (const candidate of candidates) {
		const message = usable(candidate);
		if (message) return message;
	}

	// plain Error (e.g. new Error('Logout failed')) but not ofetch's "[POST] url: 400 ..." prefix
	const raw = usable(err?.message);
	if (raw && !/^\[[a-z]+\]\s/i.test(raw)) return raw;

	return fallback;
}
