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
});
