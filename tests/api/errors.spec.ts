import { describe, expect, it } from 'vitest';
import { extractServerMessage } from '~/utils/errors';

// mirrors the ofetch FetchError shape: noisy `.message`, parsed h3 body under `.data`
describe('extractServerMessage', () => {
	it('reads the real message out of the h3 error body', () => {
		const error = {
			data: {
				statusCode: 400,
				statusMessage: 'Server Error',
				message: 'Password must be set for this user before logging in'
			},
			message: '[POST] "/api/users/login": 400 Server Error'
		};
		expect(extractServerMessage(error)).toBe(
			'Password must be set for this user before logging in'
		);
	});

	it('skips a generic statusMessage in favor of the fallback', () => {
		const error = {
			data: { statusCode: 500, statusMessage: 'Server Error' },
			message: '[POST] "/x": 500 Server Error'
		};
		expect(extractServerMessage(error, 'Could not save branding.')).toBe(
			'Could not save branding.'
		);
	});

	it('surfaces a zod issue message', () => {
		const error = {
			data: {
				statusMessage: 'Validation Error',
				issues: [{ message: 'Password must be at least 12 characters long' }]
			}
		};
		expect(extractServerMessage(error)).toBe('Password must be at least 12 characters long');
	});

	it('passes through a plain Error message', () => {
		expect(extractServerMessage(new Error('Logout failed'), 'ignored')).toBe('Logout failed');
	});

	it('ignores the ofetch "[METHOD] url: status" noise', () => {
		const error = new Error('[POST] "/api/x": 400 Bad Request');
		expect(extractServerMessage(error, 'Please try again.')).toBe('Please try again.');
	});

	it('uses the default fallback when nothing usable is present', () => {
		expect(extractServerMessage(undefined)).toBe('Something went wrong. Please try again.');
		expect(extractServerMessage({}, 'custom fallback')).toBe('custom fallback');
	});

	it('unwraps a raw ZodError json blob into a clean field sentence', () => {
		const zodMessage = JSON.stringify([
			{
				origin: 'string',
				code: 'too_small',
				minimum: 1,
				path: ['description'],
				message: 'Too small: expected string to have >=1 characters'
			}
		]);
		const error = {
			data: { name: 'ZodError', message: zodMessage },
			statusMessage: 'Validation Error',
			message: '[POST] "/api/tickets": 400 Validation Error'
		};
		expect(extractServerMessage(error)).toBe(
			'Description: Too small: expected string to have >=1 characters'
		);
	});

	it('reads the nested data.data.message candidate', () => {
		expect(extractServerMessage({ data: { data: { message: 'Nested detail' } } })).toBe(
			'Nested detail'
		);
	});

	it('falls back to a non-generic data.statusMessage', () => {
		expect(extractServerMessage({ data: { statusMessage: 'Rate limit exceeded' } })).toBe(
			'Rate limit exceeded'
		);
	});

	it('reads a non-generic top-level statusMessage', () => {
		expect(extractServerMessage({ statusMessage: 'Gateway Timeout' })).toBe('Gateway Timeout');
	});

	it('prefers a zod issue over other candidates', () => {
		const error = { data: { issues: [{ message: 'Zod says no' }], message: 'other' } };
		expect(extractServerMessage(error)).toBe('Zod says no');
	});

	it('skips every generic reason phrase (case-insensitive) for the fallback', () => {
		for (const phrase of ['error', 'Unknown Error', 'BAD REQUEST', 'Internal Server Error']) {
			expect(extractServerMessage({ data: { message: phrase } }, 'fb')).toBe('fb');
		}
	});

	it('skips a whitespace-only message', () => {
		expect(extractServerMessage({ data: { message: '   ' } }, 'fb')).toBe('fb');
	});

	it('ignores a non-string candidate', () => {
		expect(extractServerMessage({ data: { message: 123 } }, 'fb')).toBe('fb');
	});

	it('returns the fallback for a null error', () => {
		expect(extractServerMessage(null, 'fb')).toBe('fb');
	});

	it('passes a plain object .message through the raw branch', () => {
		expect(extractServerMessage({ message: 'Boom happened' })).toBe('Boom happened');
	});

	describe('zod unwrap edge cases', () => {
		it('returns the raw text when the json blob is malformed', () => {
			expect(extractServerMessage({ data: { message: '[not json' } })).toBe('[not json');
		});

		it('returns the raw text for an empty issue array', () => {
			expect(extractServerMessage({ data: { message: '[]' } })).toBe('[]');
		});

		it('omits the label prefix when the path is empty', () => {
			const blob = JSON.stringify([{ path: [], message: 'Required' }]);
			expect(extractServerMessage({ data: { message: blob } })).toBe('Required');
		});

		it('omits the label prefix when the path is not an array', () => {
			const blob = JSON.stringify([{ path: 'x', message: 'Bad' }]);
			expect(extractServerMessage({ data: { message: blob } })).toBe('Bad');
		});

		it('joins a dotted path, filtering falsy segments, and capitalizes the label', () => {
			const blob = JSON.stringify([{ path: ['user', '', null, 'name'], message: 'Invalid' }]);
			expect(extractServerMessage({ data: { message: blob } })).toBe('User.name: Invalid');
		});

		it('falls back to the raw text when the first issue has no string message', () => {
			const blob = JSON.stringify([{ path: ['x'] }]);
			expect(extractServerMessage({ data: { message: blob } })).toBe(blob);
		});
	});
});
