import { describe, expect, it } from 'vitest';
import { passwordStrength } from '~/utils/password-strength';

describe('passwordStrength', () => {
	describe('none', () => {
		it('is none for an empty string', () => {
			const result = passwordStrength('');
			expect(result.level).toBe('none');
			expect(result.score).toBe(0);
			expect(result.categories).toEqual({ lowercase: 0, uppercase: 0, digit: 0, special: 0 });
		});

		it('is none when under the 12-char floor even with all categories', () => {
			// 11 chars, all four categories present
			const result = passwordStrength('abcABC123!@');
			expect('abcABC123!@'.length).toBe(11);
			expect(result.level).toBe('none');
			expect(result.score).toBe(0);
		});

		it('is none when a category is missing (no special)', () => {
			const result = passwordStrength('Abcdefghijk1');
			expect('Abcdefghijk1'.length).toBe(12);
			expect(result.categories.special).toBe(0);
			expect(result.level).toBe('none');
		});

		it('is none for a single-category 12-char password', () => {
			const result = passwordStrength('aaaaaaaaaaaa');
			expect(result.level).toBe('none');
		});

		it('coerces a nullish input to an empty password', () => {
			const result = passwordStrength(undefined as unknown as string);
			expect(result.level).toBe('none');
			expect(result.categories).toEqual({ lowercase: 0, uppercase: 0, digit: 0, special: 0 });
		});

		it('does not count non-ascii letters toward any category', () => {
			const pw = 'ü'.repeat(12);
			expect(pw.length).toBe(12);
			const result = passwordStrength(pw);
			expect(result.categories).toEqual({ lowercase: 0, uppercase: 0, digit: 0, special: 0 });
			expect(result.level).toBe('none');
		});
	});

	describe('low', () => {
		it('is low at the bare minimum (all four present, one distinct each)', () => {
			// 9x 'a' + B + 1 + ! = 12 chars; distinct counts [1,1,1,1]
			const pw = 'aaaaaaaaaB1!';
			expect(pw.length).toBe(12);
			const result = passwordStrength(pw);
			expect(result.categories).toEqual({ lowercase: 1, uppercase: 1, digit: 1, special: 1 });
			expect(result.level).toBe('low');
			expect(result.score).toBe(1);
		});

		it('stays low when only one category has 2+ distinct chars', () => {
			// distinct counts [3,1,1,1]: only one category reaches 2, so medium is not met
			const pw = 'abcAAAAA11!!';
			expect(pw.length).toBe(12);
			const result = passwordStrength(pw);
			expect(result.categories.lowercase).toBe(3);
			expect(result.level).toBe('low');
		});
	});

	describe('medium', () => {
		it('is medium with 2+ distinct in exactly two categories', () => {
			// distinct counts [2,2,1,1]
			const pw = 'abAB11111!!!';
			expect(pw.length).toBe(12);
			const result = passwordStrength(pw);
			expect(result.categories).toEqual({ lowercase: 2, uppercase: 2, digit: 1, special: 1 });
			expect(result.level).toBe('medium');
			expect(result.score).toBe(2);
		});

		it('is medium when three categories reach 2 but none reaches 3', () => {
			// distinct counts [2,2,2,1]: categoriesWith(3) is 0, so strong is not met
			const pw = 'abAB12!aaaaa';
			expect(pw.length).toBe(12);
			const result = passwordStrength(pw);
			expect(result.categories).toEqual({ lowercase: 2, uppercase: 2, digit: 2, special: 1 });
			expect(result.level).toBe('medium');
		});
	});

	describe('strong', () => {
		it('is strong with 3+ distinct in three categories', () => {
			// distinct counts [3,3,3,1]
			const pw = 'abcABC123!!!';
			expect(pw.length).toBe(12);
			const result = passwordStrength(pw);
			expect(result.categories).toEqual({ lowercase: 3, uppercase: 3, digit: 3, special: 1 });
			expect(result.level).toBe('strong');
			expect(result.score).toBe(3);
		});

		it('does not reach best when one category has fewer than 4 distinct', () => {
			// distinct counts [4,4,4,1]
			const pw = 'abcdABCD1234!';
			expect(pw.length).toBe(13);
			const result = passwordStrength(pw);
			expect(result.categories).toEqual({ lowercase: 4, uppercase: 4, digit: 4, special: 1 });
			expect(result.level).toBe('strong');
		});

		it('is strong (not best) when all four categories reach exactly 3 distinct', () => {
			// distinct counts [3,3,3,3]: every(n>=4) is false, categoriesWith(3) is 4
			const pw = 'abcABC123!@#';
			expect(pw.length).toBe(12);
			const result = passwordStrength(pw);
			expect(result.categories).toEqual({ lowercase: 3, uppercase: 3, digit: 3, special: 3 });
			expect(result.level).toBe('strong');
		});
	});

	describe('best', () => {
		it('is best with 4+ distinct in all four categories', () => {
			// distinct counts [4,4,4,4]
			const pw = 'abcdABCD1234!@#$';
			expect(pw.length).toBe(16);
			const result = passwordStrength(pw);
			expect(result.categories).toEqual({ lowercase: 4, uppercase: 4, digit: 4, special: 4 });
			expect(result.level).toBe('best');
			expect(result.score).toBe(4);
		});

		it('is best for a long high-entropy password', () => {
			const pw = 'abcdefghABCDEFGH12345678!@#$%^&*()';
			expect(pw.length).toBeGreaterThan(20);
			const result = passwordStrength(pw);
			expect(result.level).toBe('best');
			expect(result.score).toBe(4);
		});
	});

	describe('category counting', () => {
		it('counts distinct chars, not occurrences', () => {
			const result = passwordStrength('aaaaBBBB1111!!!!');
			expect(result.categories).toEqual({ lowercase: 1, uppercase: 1, digit: 1, special: 1 });
			expect(result.level).toBe('low');
		});

		it('treats underscore as a special character (in PASSWORD_SPECIAL range)', () => {
			// 8x 'a' + B + 1 + _ = 11 -> pad to 12 with another 'a'
			const pw = 'aaaaaaaaaB1_';
			expect(pw.length).toBe(12);
			const result = passwordStrength(pw);
			expect(result.categories.special).toBe(1);
			expect(result.level).toBe('low');
		});

		it('ignores whitespace (not a special character)', () => {
			// spaces are outside PASSWORD_SPECIAL, so special stays 0 -> none
			const pw = 'abcABC123   ';
			expect(pw.length).toBe(12);
			const result = passwordStrength(pw);
			expect(result.categories.special).toBe(0);
			expect(result.level).toBe('none');
		});
	});
});
