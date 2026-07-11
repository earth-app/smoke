import { first, firstAllShardsGlobal, firstByLookupKey } from '@earth-app/collegedb';

// routed single-row reads can return null on blob columns under some collegedb
// drivers (drizzle get() shape); fall back to an all-shards scan which normalizes
// blobs. the routed read stays the fast path; the scan only runs when it misses
export async function firstRow<T = Record<string, unknown>>(
	key: string,
	sql: string,
	bindings: unknown[] = []
): Promise<T | null> {
	const routed = await first<T>(key, sql, bindings as any);
	if (routed) return routed;
	return (await firstAllShardsGlobal<T>(sql, bindings as any)) ?? null;
}

export async function firstRowByLookup<T = Record<string, unknown>>(
	lookupKey: string,
	sql: string,
	bindings: unknown[] = []
): Promise<T | null> {
	const routed = await firstByLookupKey<T>(lookupKey, sql, bindings as any);
	if (routed) return routed;
	return (await firstAllShardsGlobal<T>(sql, bindings as any)) ?? null;
}
