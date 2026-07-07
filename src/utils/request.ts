export type QueryParameters = {
	search?: string;
	page?: number;
	limit?: number;
	offset?: number;
	sort?: string;
	sort_direction?: 'asc' | 'desc';
	status?: string;
	priority?: string;
	labels?: string;
	assignee?: string;
};

export function toSearchParams(options?: QueryParameters): URLSearchParams {
	const params = new URLSearchParams();
	if (!options) return params;

	if (options.search) params.append('search', options.search);
	if (options.page) params.append('page', options.page.toString());
	if (options.limit) params.append('limit', options.limit.toString());
	if (options.offset) params.append('offset', options.offset.toString());
	if (options.sort) params.append('sort', options.sort);
	if (options.sort_direction) params.append('sort_direction', options.sort_direction);
	if (options.status) params.append('status', options.status);
	if (options.priority) params.append('priority', options.priority);
	if (options.labels) params.append('labels', options.labels);
	if (options.assignee) params.append('assignee', options.assignee);

	return params;
}
