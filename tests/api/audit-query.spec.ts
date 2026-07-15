import { describe, expect, it } from 'vitest';
import { buildAuditParams, type AuditQuery } from '~/utils/audit-query';

describe('buildAuditParams', () => {
	it('produces an empty querystring for an empty query', () => {
		expect(buildAuditParams({}).toString()).toBe('');
	});

	it('appends every provided string filter', () => {
		const q: AuditQuery = {
			search: 'foo',
			action: 'ticket.created',
			actor_id: 'u1',
			priority: 'high',
			sort: 'created_at',
			sort_direction: 'desc'
		};
		const params = buildAuditParams(q);
		expect(params.get('search')).toBe('foo');
		expect(params.get('action')).toBe('ticket.created');
		expect(params.get('actor_id')).toBe('u1');
		expect(params.get('priority')).toBe('high');
		expect(params.get('sort')).toBe('created_at');
		expect(params.get('sort_direction')).toBe('desc');
	});

	it('includes a zero ticket_id, from, and to (null-checked, not truthy)', () => {
		const params = buildAuditParams({ ticket_id: 0, from: 0, to: 0 });
		expect(params.get('ticket_id')).toBe('0');
		expect(params.get('from')).toBe('0');
		expect(params.get('to')).toBe('0');
	});

	it('stringifies numeric ticket_id, from, to, page, limit', () => {
		const params = buildAuditParams({ ticket_id: 12, from: 100, to: 200, page: 3, limit: 50 });
		expect(params.get('ticket_id')).toBe('12');
		expect(params.get('from')).toBe('100');
		expect(params.get('to')).toBe('200');
		expect(params.get('page')).toBe('3');
		expect(params.get('limit')).toBe('50');
	});

	it('skips falsy page, limit, and empty strings', () => {
		const params = buildAuditParams({ page: 0, limit: 0, search: '', action: '' });
		expect(params.has('page')).toBe(false);
		expect(params.has('limit')).toBe(false);
		expect(params.has('search')).toBe(false);
		expect(params.has('action')).toBe(false);
	});

	it('omits ticket_id, from, and to when absent', () => {
		const params = buildAuditParams({ search: 'x' });
		expect(params.has('ticket_id')).toBe(false);
		expect(params.has('from')).toBe(false);
		expect(params.has('to')).toBe(false);
	});
});
