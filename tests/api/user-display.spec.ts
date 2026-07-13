import { describe, expect, it } from 'vitest';
import { displayName } from '~/shared/utils/user-display';

describe('displayName', () => {
	it('returns empty for a nullish user', () => {
		expect(displayName(null)).toBe('');
		expect(displayName(undefined)).toBe('');
	});

	it('joins first and last when both are present', () => {
		expect(displayName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
	});

	it('uses the first name alone when there is no last name', () => {
		expect(displayName({ first_name: 'Ada' })).toBe('Ada');
	});

	it('drops a last name that has no first name (falls through to the next source)', () => {
		expect(displayName({ last_name: 'Lovelace', name: 'Legacy Name' })).toBe('Legacy Name');
		expect(displayName({ last_name: 'Lovelace', username: 'ada' })).toBe('@ada');
	});

	it('falls back to the legacy name', () => {
		expect(displayName({ name: 'Legacy Name' })).toBe('Legacy Name');
	});

	it('falls back to the @username last', () => {
		expect(displayName({ username: 'ada' })).toBe('@ada');
	});

	it('prefers a real name over the legacy name and username', () => {
		expect(displayName({ first_name: 'Ada', name: 'Legacy', username: 'ada' })).toBe('Ada');
	});

	it('trims surrounding whitespace on every source', () => {
		expect(displayName({ first_name: '  Ada  ', last_name: '  Lovelace  ' })).toBe('Ada Lovelace');
		expect(displayName({ first_name: '  Ada  ' })).toBe('Ada');
		expect(displayName({ name: '  Legacy  ' })).toBe('Legacy');
	});

	it('skips a blank name and blank first name', () => {
		expect(displayName({ first_name: '   ', name: 'Legacy' })).toBe('Legacy');
		expect(displayName({ name: '   ', username: 'ada' })).toBe('@ada');
	});

	it('returns empty when nothing usable is set', () => {
		expect(displayName({})).toBe('');
		expect(displayName({ last_name: 'Lovelace' })).toBe('');
	});
});
