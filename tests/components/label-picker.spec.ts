import { describe, expect, it } from 'vitest';
import type { Label } from '~/shared/types/user';
import {
	findLabelByName,
	isHexColor,
	isValidLabelColor,
	LABEL_COLOR_PALETTE,
	randomLabelColor,
	shouldOfferCreate,
	withLabelId,
	withoutLabelId
} from '~/utils/labelPicker';

const labels: Label[] = [
	{ id: 1, name: 'Bug', color: '#ff0000' },
	{ id: 2, name: 'Billing' },
	{ id: 3, name: 'Urgent', color: '#f59e0b' }
];

describe('findLabelByName', () => {
	it('matches case-insensitively and ignores surrounding whitespace', () => {
		expect(findLabelByName(labels, 'bug')?.id).toBe(1);
		expect(findLabelByName(labels, '  BILLING  ')?.id).toBe(2);
	});

	it('returns undefined for no match or empty input', () => {
		expect(findLabelByName(labels, 'nope')).toBeUndefined();
		expect(findLabelByName(labels, '   ')).toBeUndefined();
	});
});

describe('shouldOfferCreate', () => {
	it('offers create only for a new name when the user can manage', () => {
		expect(shouldOfferCreate(labels, 'Feature', true)).toBe(true);
	});

	it('never offers create without manage permission', () => {
		expect(shouldOfferCreate(labels, 'Feature', false)).toBe(false);
	});

	it('does not offer create for an existing name (case-insensitive)', () => {
		expect(shouldOfferCreate(labels, 'bug', true)).toBe(false);
	});

	it('does not offer create for an empty term', () => {
		expect(shouldOfferCreate(labels, '   ', true)).toBe(false);
	});
});

describe('withLabelId / withoutLabelId', () => {
	it('adds an id once and preserves order', () => {
		expect(withLabelId([1, 2], 3)).toEqual([1, 2, 3]);
		expect(withLabelId([1, 2], 2)).toEqual([1, 2]);
	});

	it('returns the same array (no copy) when the id is already present', () => {
		const arr = [1, 2];
		expect(withLabelId(arr, 2)).toBe(arr);
	});

	it('removes an id', () => {
		expect(withoutLabelId([1, 2, 3], 2)).toEqual([1, 3]);
		expect(withoutLabelId([1, 2, 3], 9)).toEqual([1, 2, 3]);
	});
});

describe('randomLabelColor', () => {
	it('always returns a color from the palette', () => {
		for (let i = 0; i < 50; i++) {
			expect(LABEL_COLOR_PALETTE).toContain(randomLabelColor());
		}
	});
});

describe('isHexColor', () => {
	it('accepts #rgb and #rrggbb', () => {
		expect(isHexColor('#fff')).toBe(true);
		expect(isHexColor('#3b82f6')).toBe(true);
		expect(isHexColor('  #ABCDEF ')).toBe(true);
	});

	it('rejects non-hex values', () => {
		expect(isHexColor('red')).toBe(false);
		expect(isHexColor('#12')).toBe(false);
		expect(isHexColor('3b82f6')).toBe(false);
	});
});

describe('isValidLabelColor', () => {
	it('accepts a nuxt theme token', () => {
		expect(isValidLabelColor('primary')).toBe(true);
		expect(isValidLabelColor('neutral')).toBe(true);
	});

	it('accepts a css hex', () => {
		expect(isValidLabelColor('#3b82f6')).toBe(true);
		expect(isValidLabelColor('#fff')).toBe(true);
	});

	it('rejects empty, partial, or unknown values', () => {
		expect(isValidLabelColor('')).toBe(false);
		expect(isValidLabelColor('#12')).toBe(false);
		expect(isValidLabelColor('blurple')).toBe(false);
	});
});
