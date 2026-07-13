import { describe, expect, it } from 'vitest';
import { toSearchParams } from '~/utils/request';

// the CLIENT query-string builder (src/utils/request.ts); distinct from the server util in utils.spec.ts
describe('toSearchParams', () => {
	it('returns an empty URLSearchParams when options are omitted', () => {
		const params = toSearchParams();
		expect(params).toBeInstanceOf(URLSearchParams);
		expect(params.toString()).toBe('');
	});

	it('returns empty for an empty object', () => {
		expect(toSearchParams({}).toString()).toBe('');
	});

	it('appends a string search term', () => {
		expect(toSearchParams({ search: 'hello world' }).get('search')).toBe('hello world');
	});

	it('stringifies numeric page/limit/offset', () => {
		const params = toSearchParams({ page: 2, limit: 50, offset: 10 });
		expect(params.get('page')).toBe('2');
		expect(params.get('limit')).toBe('50');
		expect(params.get('offset')).toBe('10');
	});

	it('carries sort + direction', () => {
		const params = toSearchParams({ sort: 'created_at', sort_direction: 'desc' });
		expect(params.get('sort')).toBe('created_at');
		expect(params.get('sort_direction')).toBe('desc');
	});

	it('carries the ticket filter fields', () => {
		const params = toSearchParams({
			status: 'open',
			priority: 'high',
			labels: '1,2',
			assignee: '@bob'
		});
		expect(params.get('status')).toBe('open');
		expect(params.get('priority')).toBe('high');
		expect(params.get('labels')).toBe('1,2');
		expect(params.get('assignee')).toBe('@bob');
	});

	it('skips undefined fields', () => {
		const params = toSearchParams({ search: undefined, page: undefined, sort: 'id' });
		expect(params.has('search')).toBe(false);
		expect(params.has('page')).toBe(false);
		expect(params.get('sort')).toBe('id');
	});

	it('skips null fields', () => {
		const params = toSearchParams({ search: null as unknown as string });
		expect(params.has('search')).toBe(false);
	});

	it('skips falsy zeros and the empty string (truthy-guarded)', () => {
		const params = toSearchParams({ page: 0, limit: 0, offset: 0, search: '' });
		expect(params.toString()).toBe('');
	});

	it('combines every field into one query string', () => {
		const params = toSearchParams({
			search: 'x',
			page: 3,
			limit: 20,
			offset: 5,
			sort: 'title',
			sort_direction: 'asc',
			status: 'pending',
			priority: 'low',
			labels: '9',
			assignee: '@ana'
		});
		expect(params.getAll('search')).toEqual(['x']);
		expect(params.get('page')).toBe('3');
		expect(params.get('sort_direction')).toBe('asc');
		expect(params.toString()).toContain('title');
	});
});
