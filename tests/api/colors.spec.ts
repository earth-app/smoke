import { describe, expect, it } from 'vitest';
import { isCustomColor, isNuxtColor, NUXT_COLORS, resolveColorVar } from '~/shared/utils/colors';

describe('NUXT_COLORS', () => {
	it('lists the seven nuxt ui semantic tokens', () => {
		expect(NUXT_COLORS).toEqual([
			'primary',
			'secondary',
			'success',
			'info',
			'warning',
			'error',
			'neutral'
		]);
	});
});

describe('isNuxtColor', () => {
	it('accepts every nuxt token', () => {
		for (const token of NUXT_COLORS) expect(isNuxtColor(token)).toBe(true);
	});

	it('rejects a hex, an unknown token, and empty/nullish input', () => {
		expect(isNuxtColor('#3b82f6')).toBe(false);
		expect(isNuxtColor('blurple')).toBe(false);
		expect(isNuxtColor('')).toBe(false);
		expect(isNuxtColor(null)).toBe(false);
		expect(isNuxtColor(undefined)).toBe(false);
	});
});

describe('isCustomColor', () => {
	it('accepts #rgb and #rrggbb (case-insensitive)', () => {
		expect(isCustomColor('#fff')).toBe(true);
		expect(isCustomColor('#3b82f6')).toBe(true);
		expect(isCustomColor('#ABCDEF')).toBe(true);
	});

	it('accepts rgb() and rgba() prefixes', () => {
		expect(isCustomColor('rgb(0,0,0)')).toBe(true);
		expect(isCustomColor('rgba(0,0,0,0.5)')).toBe(true);
	});

	it('rejects a partial hex, a token, and empty/nullish input', () => {
		expect(isCustomColor('#12')).toBe(false);
		expect(isCustomColor('#gggggg')).toBe(false);
		expect(isCustomColor('primary')).toBe(false);
		expect(isCustomColor('')).toBe(false);
		expect(isCustomColor(null)).toBe(false);
		expect(isCustomColor(undefined)).toBe(false);
	});
});

describe('resolveColorVar', () => {
	it('maps a nuxt token to its css variable', () => {
		expect(resolveColorVar('primary')).toBe('var(--ui-color-primary-500)');
		expect(resolveColorVar('neutral')).toBe('var(--ui-color-neutral-500)');
	});

	it('passes a hex or rgb value through unchanged', () => {
		expect(resolveColorVar('#3b82f6')).toBe('#3b82f6');
		expect(resolveColorVar('rgb(1,2,3)')).toBe('rgb(1,2,3)');
	});

	it('returns the default fallback for nullish input', () => {
		expect(resolveColorVar(null)).toBe('var(--ui-text-muted)');
		expect(resolveColorVar(undefined)).toBe('var(--ui-text-muted)');
		expect(resolveColorVar('')).toBe('var(--ui-text-muted)');
	});

	it('returns the fallback for an unrecognized value', () => {
		expect(resolveColorVar('blurple')).toBe('var(--ui-text-muted)');
		expect(resolveColorVar('#12')).toBe('var(--ui-text-muted)');
	});

	it('honors a custom fallback', () => {
		expect(resolveColorVar('nonsense', 'red')).toBe('red');
		expect(resolveColorVar(null, 'red')).toBe('red');
	});
});
