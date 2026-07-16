// the row id doubles as the collegedb routing key, so it must be a pre-computed value (not a db
// autoincrement). MAX(id)+1 races under concurrent writers -> UNIQUE constraint failed. this retries
// the read-max -> insert cycle so parallel creates settle onto distinct ids instead of colliding.

// the libsql/drizzle driver wraps the failure as "Failed query: ..." and puts the real sqlite
// reason on .cause, so check both. retry on an id collision (two writers read the same MAX) and on
// transient lock contention (concurrent writers on one sqlite file)
function isRetriableWriteError(error: unknown): boolean {
	const e = error as { message?: string; cause?: { message?: string } };
	const text = `${e?.message ?? ''} ${e?.cause?.message ?? ''}`;
	return /UNIQUE constraint failed|SQLITE_CONSTRAINT|constraint failed: \w+\.id|database is locked|database table is locked|SQLITE_BUSY/i.test(
		text
	);
}

/**
 * Assigns the next sequential id and inserts, retrying on a unique-id collision so concurrent
 * writers converge on distinct ids. `readNextId` returns `COALESCE(MAX(id),0)+1`; `insert` runs the
 * INSERT with the routing key `String(id)`. Returns the id actually used.
 */
export async function insertWithNextId(
	readNextId: () => Promise<number>,
	insert: (id: number) => Promise<unknown>,
	attempts = 6
): Promise<number> {
	for (let attempt = 0; ; attempt++) {
		const id = await readNextId();
		try {
			await insert(id);
			return id;
		} catch (error) {
			if (attempt < attempts - 1 && isRetriableWriteError(error)) continue;
			throw error;
		}
	}
}
