import { describe, expect, it } from 'vitest';
import { resolveAvatarBody } from '~/utils/avatar';

describe('resolveAvatarBody', () => {
	it('wraps a File in multipart form data', () => {
		const file = new File(['x'], 'a.png', { type: 'image/png' });
		const body = resolveAvatarBody(file);
		expect(body).toBeInstanceOf(FormData);
		expect((body as FormData).get('avatar')).toBe(file);
	});

	it('wraps a Blob in multipart form data', () => {
		const blob = new Blob(['x'], { type: 'image/png' });
		const body = resolveAvatarBody(blob);
		expect(body).toBeInstanceOf(FormData);
		expect((body as FormData).get('avatar')).toBeInstanceOf(Blob);
	});

	it('wraps an ArrayBuffer in multipart form data as a Blob', () => {
		const buffer = new ArrayBuffer(8);
		const body = resolveAvatarBody(buffer);
		expect(body).toBeInstanceOf(FormData);
		const value = (body as FormData).get('avatar');
		expect(value).toBeInstanceOf(Blob);
	});

	it('maps an https string to a url body', () => {
		expect(resolveAvatarBody('https://example.com/a.png')).toEqual({
			url: 'https://example.com/a.png'
		});
	});

	it('maps a data:image uri to a base64 body', () => {
		const uri = 'data:image/png;base64,AAAA';
		expect(resolveAvatarBody(uri)).toEqual({ base64: uri });
	});

	it('maps an { icon } object to an icon body', () => {
		expect(resolveAvatarBody({ icon: 'mdi:account' })).toEqual({ icon: 'mdi:account' });
	});

	it('rejects an http url', () => {
		expect(() => resolveAvatarBody('http://example.com/a.png')).toThrow(
			'Invalid avatar string format'
		);
	});

	it('rejects a non-image data uri', () => {
		expect(() => resolveAvatarBody('data:text/plain;base64,AAAA')).toThrow(
			'Invalid avatar string format'
		);
	});

	it('rejects an arbitrary string', () => {
		expect(() => resolveAvatarBody('not-a-url')).toThrow('Invalid avatar string format');
	});
});
