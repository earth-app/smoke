import { describe, expect, it } from 'vitest';
import { normalizeSessionToken } from '~/utils/session-token';

describe('normalizeSessionToken', () => {
	it('returns null for null', () => {
		expect(normalizeSessionToken(null)).toBeNull();
	});

	it('returns null for undefined', () => {
		expect(normalizeSessionToken(undefined)).toBeNull();
	});

	it('returns null for an empty string', () => {
		expect(normalizeSessionToken('')).toBeNull();
	});

	it('passes a plain token through unchanged', () => {
		expect(normalizeSessionToken('abc123')).toBe('abc123');
	});

	it('trims surrounding whitespace', () => {
		expect(normalizeSessionToken('  abc123  ')).toBe('abc123');
	});

	it('returns null when the value trims to empty', () => {
		expect(normalizeSessionToken('   ')).toBeNull();
	});

	it('url-decodes an encoded token', () => {
		expect(normalizeSessionToken('a%20b')).toBe('a b');
	});

	it('keeps the raw token when percent-decoding throws', () => {
		// a lone % is malformed percent-encoding; decodeURIComponent throws and we keep the raw value
		expect(normalizeSessionToken('%')).toBe('%');
	});

	it('strips a single pair of surrounding double quotes', () => {
		expect(normalizeSessionToken('"quoted"')).toBe('quoted');
	});

	it('returns null when a quoted value strips to empty', () => {
		expect(normalizeSessionToken('""')).toBeNull();
	});

	it('does not strip a single leading quote', () => {
		expect(normalizeSessionToken('"')).toBe('"');
	});

	it('does not strip when only one side is quoted', () => {
		expect(normalizeSessionToken('abc"')).toBe('abc"');
		expect(normalizeSessionToken('"abc')).toBe('"abc');
	});

	it('decodes then strips an encoded-quoted token', () => {
		expect(normalizeSessionToken('%22abc%22')).toBe('abc');
	});

	it('trims first so quotes are detected after whitespace is removed', () => {
		expect(normalizeSessionToken('  "abc"  ')).toBe('abc');
	});
});
