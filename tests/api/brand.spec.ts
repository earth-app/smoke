import { describe, expect, it } from 'vitest';
import { PROJECT_NAME } from '~/shared/utils/brand';

describe('PROJECT_NAME', () => {
	it('is the fixed software credit', () => {
		expect(PROJECT_NAME).toBe('Smoke by The Earth App');
	});
});
