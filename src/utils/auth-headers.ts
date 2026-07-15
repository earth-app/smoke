// bearer auth headers for authed store fetches; empty when signed out
export function bearerHeaders(token: string | null | undefined): Record<string, string> {
	return token ? { Authorization: `Bearer ${token}` } : {};
}
