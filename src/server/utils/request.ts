import type { H3Event } from 'h3';

export function primitiveQuery(event: H3Event, sortFields: string[] = ['created_at']) {
	const { search, sort, sort_direction } = getQuery(event);

	const search0 = search?.toString() || '';
	if (search0.length > 120) {
		throw createError({
			statusCode: 400,
			message: 'Search parameter too long, max is 120 characters',
			data: { search: search0 }
		});
	}

	const validSortDirections = ['asc', 'desc'];
	const sort0 = sort?.toString() || 'created_at';
	if (!sortFields.includes(sort0)) {
		throw createError({
			statusCode: 400,
			message: `Invalid sort parameter, must be one of: ${sortFields.join(', ')}`,
			data: { sort }
		});
	}

	const sort_direction0: 'asc' | 'desc' = (sort_direction?.toString() as 'asc' | 'desc') || 'desc';
	if (!validSortDirections.includes(sort_direction0)) {
		throw createError({
			statusCode: 400,
			message: `Invalid sort_direction parameter, must be one of: ${validSortDirections.join(', ')}`,
			data: { sort_direction }
		});
	}

	return {
		search: search0,
		sort: sort0,
		sort_direction: sort_direction0
	};
}

export function query(event: H3Event, sortFields: string[] = ['created_at']) {
	const { search, sort, sort_direction } = primitiveQuery(event, sortFields);
	const { page, limit } = getQuery(event);

	const page0 = page ? parseInt(page as string, 10) : 1;
	if (isNaN(page0) || page0 < 1) {
		throw createError({
			statusCode: 400,
			message: 'Invalid page parameter, must be a positive integer',
			data: { page }
		});
	}

	const limit0 = limit ? parseInt(limit as string, 10) : 10;
	if (isNaN(limit0) || limit0 < 1 || limit0 > 100) {
		throw createError({
			statusCode: 400,
			message: 'Invalid limit parameter, must be a positive integer between 1 and 100',
			data: { limit }
		});
	}

	return {
		search,
		page: page0,
		limit: limit0,
		offset: (page0 - 1) * limit0,
		sort,
		sort_direction
	};
}
