import { beforeEach, describe, expect, it } from 'vitest';
import { getRuntime } from './route-runtime';

// #server-utils pulls in schema.ts (import { kv } from 'hub:kv'), so it must load AFTER route-runtime's
// vi.mock('hub:kv') is registered -- grab it dynamically per test, never as a static top import
let c: typeof import('#server-utils');
beforeEach(async () => {
	c = await import('#server-utils');
});

// exercises the two-tier cache (L1 in-isolate memory + L2 the kv binding): read-through, negative
// caching, embedded-expiry, clear/clear-prefix, the L1 tier itself, and the centralized invalidators
describe('server/utils/cache', () => {
	it('read-through caches the fetcher result and does not re-run it within ttl', async () => {
		let calls = 0;
		const fetcher = async () => {
			calls++;
			return { value: calls };
		};

		const a = await c.cache('smoke:cache:t:read-through', fetcher, 60);
		const b = await c.cache('smoke:cache:t:read-through', fetcher, 60);

		expect(a).toEqual({ value: 1 });
		expect(b).toEqual({ value: 1 });
		expect(calls).toBe(1);
	});

	it('caches a null result so negative lookups do not re-run the fetcher', async () => {
		let calls = 0;
		const fetcher = async () => {
			calls++;
			return null;
		};

		const a = await c.cache('smoke:cache:t:negative', fetcher, 60);
		const b = await c.cache('smoke:cache:t:negative', fetcher, 60);

		expect(a).toBeNull();
		expect(b).toBeNull();
		expect(calls).toBe(1);
	});

	it('treats an expired L2 entry as a miss and re-fetches', async () => {
		const { hubKv } = getRuntime();
		const key = 'smoke:cache:t:expired';
		// a wrapped value whose embedded expiry is already in the past
		await hubKv.set(key, JSON.stringify({ v: 'stale', e: Date.now() - 1000 }));

		let calls = 0;
		const result = await c.cache(
			key,
			async () => {
				calls++;
				return 'fresh';
			},
			60
		);

		expect(result).toBe('fresh');
		expect(calls).toBe(1);
	});

	it('honors an unexpired L2 entry written directly', async () => {
		const { hubKv } = getRuntime();
		const key = 'smoke:cache:t:unexpired';
		await hubKv.set(key, JSON.stringify({ v: 'cached', e: Date.now() + 60_000 }));

		let calls = 0;
		const result = await c.cache(
			key,
			async () => {
				calls++;
				return 'fresh';
			},
			60
		);

		expect(result).toBe('cached');
		expect(calls).toBe(0);
	});

	it('honors a legacy unwrapped entry (written before the wrapper existed)', async () => {
		const { hubKv } = getRuntime();
		const key = 'smoke:cache:t:legacy';
		await hubKv.set(key, JSON.stringify('legacy-value'));

		const result = await c.cache(key, async () => 'fresh', 60);
		expect(result).toBe('legacy-value');
	});

	it('serves from the L1 memory tier after L2 is gone, and resetCache clears it', async () => {
		const { hubKv } = getRuntime();
		const key = 'smoke:cache:t:l1';
		let calls = 0;
		const fetcher = async () => {
			calls++;
			return `v${calls}`;
		};

		const a = await c.cache(key, fetcher, 60);
		// wipe only L2, as another isolate's clearCache would; the current isolate's L1 still holds it
		await hubKv.del(key);
		const b = await c.cache(key, fetcher, 60);
		expect(b).toBe(a);
		expect(calls).toBe(1);

		// dropping L1 forces a real miss on both tiers
		c.resetCache();
		const d = await c.cache(key, fetcher, 60);
		expect(d).toBe('v2');
		expect(calls).toBe(2);
	});

	it('setCache + getCache round-trips; getCache returns null when absent', async () => {
		expect(await c.getCache('smoke:cache:t:absent')).toBeNull();
		await c.setCache('smoke:cache:t:direct', { ok: true }, 60);
		expect(await c.getCache('smoke:cache:t:direct')).toEqual({ ok: true });
	});

	it('clearCache drops the entry from both tiers', async () => {
		const key = 'smoke:cache:t:clear';
		await c.setCache(key, 'x', 60);
		await c.clearCache(key);
		expect(await c.getCache(key)).toBeNull();
	});

	it('clearCachePrefix drops every key under the prefix and leaves others', async () => {
		await c.setCache('smoke:cache:t:grp:1', 'a', 60);
		await c.setCache('smoke:cache:t:grp:2', 'b', 60);
		await c.setCache('smoke:cache:t:other:1', 'c', 60);

		await c.clearCachePrefix('smoke:cache:t:grp:');

		expect(await c.getCache('smoke:cache:t:grp:1')).toBeNull();
		expect(await c.getCache('smoke:cache:t:grp:2')).toBeNull();
		expect(await c.getCache('smoke:cache:t:other:1')).toBe('c');
	});

	it('invalidateUser busts id/email keys + the list prefix', async () => {
		await c.setCache(c.userIdKey('u1'), { id: 'u1' }, 60);
		await c.setCache(c.userEmailKey('hash1'), { id: 'u1' }, 60);
		await c.setCache(`${c.USER_LIST_PREFIX}search:1:10:id:asc`, [1], 60);

		await c.invalidateUser('u1', { emailHashes: ['hash1'] });

		expect(await c.getCache(c.userIdKey('u1'))).toBeNull();
		expect(await c.getCache(c.userEmailKey('hash1'))).toBeNull();
		expect(await c.getCache(`${c.USER_LIST_PREFIX}search:1:10:id:asc`)).toBeNull();
	});

	it('invalidateCustomer busts the id key + the list prefix', async () => {
		await c.setCache(c.customerIdKey(7), { id: 7 }, 60);
		await c.setCache(`${c.CUSTOMER_LIST_PREFIX}::1:10:created_at:desc`, [7], 60);

		await c.invalidateCustomer(7);

		expect(await c.getCache(c.customerIdKey(7))).toBeNull();
		expect(await c.getCache(`${c.CUSTOMER_LIST_PREFIX}::1:10:created_at:desc`)).toBeNull();
	});

	it('invalidateTicket busts the id key + the list + analytics prefixes', async () => {
		await c.setCache(c.ticketIdKey(42), { id: 42 }, 60);
		await c.setCache(`${c.TICKET_LIST_PREFIX}::1:10:created_at:desc`, [42], 60);
		await c.setCache(`${c.ANALYTICS_PREFIX}7d`, { total: 1 }, 60);

		await c.invalidateTicket(42);

		expect(await c.getCache(c.ticketIdKey(42))).toBeNull();
		expect(await c.getCache(`${c.TICKET_LIST_PREFIX}::1:10:created_at:desc`)).toBeNull();
		expect(await c.getCache(`${c.ANALYTICS_PREFIX}7d`)).toBeNull();
	});
});
