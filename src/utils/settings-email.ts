// merge a partial email config into the persisted one so independent cards (outbound smtp, inbound
// poll) never clobber each other; the server replaces the whole email blob on save
export function mergeEmailSettings(
	current: Record<string, any> | null | undefined,
	partial: Record<string, any>
): Record<string, any> {
	const base = { ...(current || {}) };
	const merged: Record<string, any> = { ...base, ...partial };
	if (base.smtp || partial.smtp) {
		merged.smtp = { ...(base.smtp || {}), ...(partial.smtp || {}) };
		delete merged.smtp.has_password;
	}
	if (base.poll || partial.poll) {
		merged.poll = { ...(base.poll || {}), ...(partial.poll || {}) };
		delete merged.poll.has_password;
	}
	return merged;
}
