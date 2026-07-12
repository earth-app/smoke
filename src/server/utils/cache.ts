// two-tier read-through cache (mirrors mylora/nuxtpress): L1 in-isolate memory + L2 the kv binding
//
// why L1: on a low-traffic worker a kv cold read is itself ~100-300ms, so a warm isolate serving a
// burst of reads should pay zero i/o. the map gives that. L2 keeps state across isolates + deploys.
//
// cross-isolate caveat: clearCache only reaches L2 (global) + the current isolate's L1; other isolates
// keep a stale L1 up to its expiry. smoke's L2 ttls run long (getUserById is 4h), so L1 is capped at
// L1_TTL_CAP_MS independent of the L2 ttl -- a warm isolate still skips i/o, but post-write staleness on
// a different isolate is bounded to the cap, not the full 4h (L2 is busted immediately, everywhere).

type Wrapped<T> = { v: T; e: number };

const L1_MAX = 2000;
const L1_TTL_CAP_MS = 30_000;

const l1 = new Map<string, Wrapped<unknown>>();

function l1Set(key: string, w: Wrapped<unknown>) {
	// re-insert so iteration order is LRU-ish; evict the oldest past the cap
	l1.delete(key);
	l1.set(key, w);
	if (l1.size > L1_MAX) l1.delete(l1.keys().next().value as string);
}

function isWrapped(x: unknown): x is Wrapped<unknown> {
	return !!x && typeof x === 'object' && 'v' in x && typeof (x as { e?: unknown }).e === 'number';
}

// returns the live wrapped entry or undefined on a miss; a cached `null` VALUE is a hit, not a miss,
// so negative lookups (user-not-found) stay cached the way the kv-only version cached them
async function readWrapped<T>(key: string): Promise<Wrapped<T> | undefined> {
	const now = Date.now();

	const mem = l1.get(key) as Wrapped<T> | undefined;
	if (mem) {
		if (mem.e > now) return mem;
		l1.delete(key);
	}

	let raw: string | null;
	try {
		raw = await kv.get<string>(key);
	} catch {
		return undefined;
	}
	if (typeof raw !== 'string') return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		await kv.del(key).catch(() => {});
		return undefined;
	}

	if (isWrapped(parsed)) {
		if (parsed.e <= now) return undefined;
		l1Set(key, { v: parsed.v, e: Math.min(parsed.e, now + L1_TTL_CAP_MS) });
		return parsed as Wrapped<T>;
	}

	// legacy unwrapped entry (written before this cache existed); treat it as the value with a capped ttl
	const legacy = { v: parsed as T, e: now + L1_TTL_CAP_MS };
	l1Set(key, legacy);
	return legacy;
}

// write a value into both tiers; L2 holds the full ttl, L1 is capped (see the header note)
export async function setCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
	const now = Date.now();
	const l2Expiry = now + ttlSeconds * 1000;
	l1Set(key, { v: value, e: Math.min(l2Expiry, now + L1_TTL_CAP_MS) });
	try {
		await kv.set(key, JSON.stringify({ v: value, e: l2Expiry }), { ttl: ttlSeconds });
	} catch (error) {
		console.warn(`cache set failed for ${key}:`, error);
	}
}

// read-through: return the cached value or run the fetcher once and cache its result
export async function cache<T>(
	key: string,
	fetcher: () => Promise<T>,
	ttlSeconds: number = 60
): Promise<T> {
	const hit = await readWrapped<T>(key);
	if (hit) return hit.v;

	const data = await fetcher();
	await setCache(key, data, ttlSeconds);
	return data;
}

// direct read; null means absent/expired (matches mylora's getCache), so it can't distinguish a cached
// null value -- use `cache()` when negative caching must survive
export async function getCache<T>(key: string): Promise<T | null> {
	const hit = await readWrapped<T>(key);
	return hit ? ((hit.v ?? null) as T | null) : null;
}

export async function clearCache(key: string): Promise<void> {
	l1.delete(key);
	try {
		await kv.del(key);
	} catch (error) {
		console.warn(`cache clear failed for ${key}:`, error);
	}
}

export async function clearCachePrefix(prefix: string): Promise<void> {
	for (const k of [...l1.keys()]) if (k.startsWith(prefix)) l1.delete(k);
	try {
		const keys: string[] = await kv.keys(prefix);
		await Promise.all(keys.map((k: string) => kv.del(k)));
	} catch (error) {
		console.warn(`cache clear-prefix failed for ${prefix}:`, error);
	}
}

// flush the whole L1 map; used by the test harness between cases (L1 is module-scoped, so it would
// otherwise leak a hit from a prior test into the next one after the in-memory kv is reset)
export function resetCache(): void {
	l1.clear();
}

// #region centralized cache keys + invalidators
// one place owns the `smoke:cache:*` key shape so a writer can never bust a key that reads differently

const PREFIX = 'smoke:cache:';

export const userIdKey = (id: string) => `${PREFIX}user_id:${id}`;
export const userUsernameKey = (username: string) => `${PREFIX}user_username:${username}`;
export const userEmailKey = (emailLookupHash: string) => `${PREFIX}user_email:${emailLookupHash}`;
export const USER_LIST_PREFIX = `${PREFIX}user:list:`;

export const customerIdKey = (id: number) => `${PREFIX}customer_id:${id}`;
export const CUSTOMER_LIST_PREFIX = `${PREFIX}customer:list:`;

export const ticketIdKey = (id: number) => `${PREFIX}ticket_id:${id}`;
export const TICKET_LIST_PREFIX = `${PREFIX}tickets:`;
export const ANALYTICS_PREFIX = `${PREFIX}analytics:`;

// role/perm/profile/email changed -> the session hot path + any lookup by the old keys must re-read
export async function invalidateUser(
	id: string,
	opts?: { usernames?: (string | undefined)[]; emailHashes?: (string | undefined)[] }
): Promise<void> {
	await clearCache(userIdKey(id));
	for (const username of opts?.usernames ?? [])
		if (username) await clearCache(userUsernameKey(username));
	for (const hash of opts?.emailHashes ?? []) if (hash) await clearCache(userEmailKey(hash));
	await clearCachePrefix(USER_LIST_PREFIX);
}

export async function invalidateCustomer(id: number): Promise<void> {
	await clearCache(customerIdKey(id));
	await clearCachePrefix(CUSTOMER_LIST_PREFIX);
}

// a ticket write also shifts the list + the ticket-derived analytics summary
export async function invalidateTicket(id: number): Promise<void> {
	await clearCache(ticketIdKey(id));
	await clearCachePrefix(TICKET_LIST_PREFIX);
	await clearCachePrefix(ANALYTICS_PREFIX);
}
// #endregion
