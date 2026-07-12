import { first, firstAllShardsGlobal, firstByLookupKey } from '@earth-app/collegedb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstRow, firstRowByLookup } from '~/server/utils/shard';

// the routed single-row reads can drop blob rows on some drivers; firstRow/
// firstRowByLookup must fall back to an all-shards scan when they return null
vi.mock('@earth-app/collegedb', () => ({
	first: vi.fn(),
	firstByLookupKey: vi.fn(),
	firstAllShardsGlobal: vi.fn()
}));

const mFirst = vi.mocked(first);
const mLookup = vi.mocked(firstByLookupKey);
const mScan = vi.mocked(firstAllShardsGlobal);

describe('firstRow', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns the routed row without scanning when present', async () => {
		mFirst.mockResolvedValue({ id: 'a' } as never);
		const row = await firstRow('a', 'SELECT * FROM t WHERE id = ?', ['a']);
		expect(row).toEqual({ id: 'a' });
		expect(mScan).not.toHaveBeenCalled();
	});

	it('falls back to an all-shards scan when the routed read returns null', async () => {
		mFirst.mockResolvedValue(null as never);
		mScan.mockResolvedValue({ id: 'b', data: 'blob' } as never);
		const row = await firstRow('b', 'SELECT * FROM t WHERE id = ?', ['b']);
		expect(row).toEqual({ id: 'b', data: 'blob' });
		expect(mScan).toHaveBeenCalledOnce();
	});

	it('returns null when both the routed read and the scan miss', async () => {
		mFirst.mockResolvedValue(null as never);
		mScan.mockResolvedValue(null as never);
		expect(await firstRow('c', 'SELECT 1', [])).toBeNull();
	});
});

describe('firstRowByLookup', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns the lookup row without scanning when present', async () => {
		mLookup.mockResolvedValue({ id: 'a' } as never);
		const row = await firstRowByLookup('username:a', 'SELECT * FROM users WHERE username = ?', [
			'a'
		]);
		expect(row).toEqual({ id: 'a' });
		expect(mScan).not.toHaveBeenCalled();
	});

	it('falls back to an all-shards scan when the lookup returns null', async () => {
		mLookup.mockResolvedValue(null as never);
		mScan.mockResolvedValue({ id: 'b' } as never);
		const row = await firstRowByLookup('username:b', 'SELECT * FROM users WHERE username = ?', [
			'b'
		]);
		expect(row).toEqual({ id: 'b' });
		expect(mScan).toHaveBeenCalledOnce();
	});
});
