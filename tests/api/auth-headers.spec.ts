import { describe, expect, it } from 'vitest';
import { bearerHeaders } from '~/utils/auth-headers';

describe('bearerHeaders', () => {
	it('builds a bearer header for a token', () => {
		expect(bearerHeaders('tok123')).toEqual({ Authorization: 'Bearer tok123' });
	});

	it('returns an empty object for null', () => {
		expect(bearerHeaders(null)).toEqual({});
	});

	it('returns an empty object for undefined', () => {
		expect(bearerHeaders(undefined)).toEqual({});
	});

	it('returns an empty object for an empty string', () => {
		expect(bearerHeaders('')).toEqual({});
	});
});
