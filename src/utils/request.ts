export type QueryParameters = {
	search?: string;
	page?: number;
	limit?: number;
	offset?: number;
	sort?: string;
	sort_direction?: 'asc' | 'desc';
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

	return params;
}
