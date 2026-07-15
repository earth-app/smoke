export type AuditQuery = {
	search?: string;
	action?: string;
	actor_id?: string;
	ticket_id?: number;
	priority?: string;
	// unix seconds inclusive range
	from?: number;
	to?: number;
	page?: number;
	limit?: number;
	sort?: string;
	sort_direction?: 'asc' | 'desc';
};

// serialize an audit query into a stable querystring (skips empty/absent fields)
export function buildAuditParams(q: AuditQuery): URLSearchParams {
	const params = new URLSearchParams();
	if (q.search) params.append('search', q.search);
	if (q.action) params.append('action', q.action);
	if (q.actor_id) params.append('actor_id', q.actor_id);
	if (q.ticket_id != null) params.append('ticket_id', String(q.ticket_id));
	if (q.priority) params.append('priority', q.priority);
	if (q.from != null) params.append('from', String(q.from));
	if (q.to != null) params.append('to', String(q.to));
	if (q.page) params.append('page', String(q.page));
	if (q.limit) params.append('limit', String(q.limit));
	if (q.sort) params.append('sort', q.sort);
	if (q.sort_direction) params.append('sort_direction', q.sort_direction);
	return params;
}
