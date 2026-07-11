import { PASSWORD_SPECIAL } from '~/shared/utils/schemas';

export type PasswordLevel = 'none' | 'low' | 'medium' | 'strong' | 'best';

export interface PasswordCategories {
	lowercase: number;
	uppercase: number;
	digit: number;
	special: number;
}

export interface PasswordStrengthResult {
	level: PasswordLevel;
	// 0-4; the number of filled meter segments (none=0 .. best=4)
	score: number;
	categories: PasswordCategories;
}

// base floor mirrors passwordParam: 12+ chars and all four categories present
export const PASSWORD_MIN_LENGTH = 12;

// distinct-char counts per category; special is any char matching PASSWORD_SPECIAL
function countCategories(password: string): PasswordCategories {
	const lower = new Set<string>();
	const upper = new Set<string>();
	const digit = new Set<string>();
	const special = new Set<string>();

	for (const char of password) {
		if (char >= 'a' && char <= 'z') lower.add(char);
		else if (char >= 'A' && char <= 'Z') upper.add(char);
		else if (char >= '0' && char <= '9') digit.add(char);
		else if (PASSWORD_SPECIAL.test(char)) special.add(char);
	}

	return {
		lowercase: lower.size,
		uppercase: upper.size,
		digit: digit.size,
		special: special.size
	};
}

export function passwordStrength(password: string): PasswordStrengthResult {
	const pw = password ?? '';
	const categories = countCategories(pw);
	const counts = [categories.lowercase, categories.uppercase, categories.digit, categories.special];

	// none: misses a category or falls under the length floor
	const meetsBase = pw.length >= PASSWORD_MIN_LENGTH && counts.every((n) => n >= 1);
	if (!meetsBase) return { level: 'none', score: 0, categories };

	const categoriesWith = (distinct: number) => counts.filter((n) => n >= distinct).length;

	// best -> strong -> medium, otherwise the bare-minimum low
	if (counts.every((n) => n >= 4)) return { level: 'best', score: 4, categories };
	if (categoriesWith(3) >= 3) return { level: 'strong', score: 3, categories };
	if (categoriesWith(2) >= 2) return { level: 'medium', score: 2, categories };
	return { level: 'low', score: 1, categories };
}
