import { ensureCollegeDB } from 'hub:db:schema';

const DAY_SECONDS = 86_400;

export type AuditCleanupResult = { purged: boolean; cutoff: number | null };

// purge audit rows past the configured retention window; no-op when retention is unset/<=0
export async function runAuditCleanup(env: any): Promise<AuditCleanupResult> {
	ensureCollegeDB(env);

	const { retention_days } = await getAuditSettings();
	if (typeof retention_days !== 'number' || retention_days <= 0) {
		return { purged: false, cutoff: null };
	}

	const cutoff = Math.floor(Date.now() / 1000) - Math.floor(retention_days) * DAY_SECONDS;
	await purgeAuditBefore(env, cutoff);
	return { purged: true, cutoff };
}

export default defineTask({
	meta: {
		name: 'audit:cleanup',
		description: 'Purge audit-log entries older than the configured retention window'
	},
	async run(): Promise<{ result: Record<string, unknown> }> {
		// secrets come from process.env (text bindings under nodejs_compat); db/kv are hub bindings
		const env = {
			MASTER_KEY: process.env.MASTER_KEY,
			HMAC_SECRET: process.env.HMAC_SECRET
		} as any;

		// missing secrets -> cannot init the shards; skip quietly so a deploy never breaks
		if (!env.MASTER_KEY || !env.HMAC_SECRET) {
			return { result: { purged: false, skipped: 'not-configured' } };
		}

		try {
			ensureCollegeDB(env);
			const out = await runAuditCleanup(env);
			return { result: out };
		} catch (error) {
			console.warn('scheduled audit cleanup failed', error);
			return { result: { purged: false, error: String(error) } };
		}
	}
});
