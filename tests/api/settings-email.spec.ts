import { describe, expect, it } from 'vitest';
import { mergeEmailSettings } from '~/utils/settings-email';

describe('mergeEmailSettings', () => {
	it('returns an empty object when both sides are empty', () => {
		expect(mergeEmailSettings(null, {})).toEqual({});
		expect(mergeEmailSettings(undefined, {})).toEqual({});
	});

	it('merges top-level keys', () => {
		expect(mergeEmailSettings({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
	});

	it('lets the partial override the current for a top-level key', () => {
		expect(mergeEmailSettings({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
	});

	it('deep-merges smtp present in both and drops has_password', () => {
		const merged = mergeEmailSettings(
			{ smtp: { host: 'old', has_password: true } },
			{ smtp: { port: 465 } }
		);
		expect(merged.smtp).toEqual({ host: 'old', port: 465 });
		expect('has_password' in merged.smtp).toBe(false);
	});

	it('merges smtp present only in the partial', () => {
		const merged = mergeEmailSettings({}, { smtp: { host: 'x', has_password: false } });
		expect(merged.smtp).toEqual({ host: 'x' });
	});

	it('carries smtp present only in the current and drops has_password', () => {
		const merged = mergeEmailSettings({ smtp: { host: 'x', has_password: true } }, { other: 1 });
		expect(merged.smtp).toEqual({ host: 'x' });
		expect(merged.other).toBe(1);
	});

	it('deep-merges poll and drops has_password', () => {
		const merged = mergeEmailSettings(
			{ poll: { host: 'old', has_password: true } },
			{ poll: { username: 'u' } }
		);
		expect(merged.poll).toEqual({ host: 'old', username: 'u' });
	});

	it('does not add smtp or poll keys when neither side has them', () => {
		const merged = mergeEmailSettings({ a: 1 }, { b: 2 });
		expect('smtp' in merged).toBe(false);
		expect('poll' in merged).toBe(false);
	});

	it('does not mutate the current object', () => {
		const current = { smtp: { host: 'x', has_password: true } };
		mergeEmailSettings(current, { smtp: { port: 25 } });
		expect(current.smtp.has_password).toBe(true);
		expect('port' in current.smtp).toBe(false);
	});
});
