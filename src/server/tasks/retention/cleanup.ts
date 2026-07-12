import { allAllShardsGlobal } from '@earth-app/collegedb';
import { ensureCollegeDB } from 'hub:db:schema';
import { TicketStatus } from '~/shared/types/ticket';
import { Permission, Role, type User } from '~/shared/types/user';

const DAY_MS = 86_400_000;

// a synthetic system viewer so retention sees every ticket regardless of visibility
function systemViewer(): User {
	return {
		id: 'retention-system',
		username: 'retention',
		email: 'retention@system.local',
		role: Role.Admin,
		permissions: [Permission.ViewPrivateTickets, Permission.ManageTicket],
		created_at: new Date(),
		updated_at: new Date(),
		labels: []
	};
}

export type RetentionResult = { scanned: number; archived: number; deleted: number };

// archive resolved-and-stale tickets, then purge long-archived ones per retention settings
export async function runRetention(env: any): Promise<RetentionResult> {
	ensureCollegeDB(env);

	const { archive_days, delete_days } = await getRetentionSettings();
	const viewer = systemViewer();
	const now = Date.now();

	const rows = await allAllShardsGlobal<{ id: number }>('SELECT id FROM tickets', []);
	let scanned = 0;
	let archived = 0;
	let deleted = 0;

	for (const row of rows.results) {
		const id = Number(row.id);
		const ticket = await getTicketById(id, env, viewer);
		if (!ticket) continue;
		scanned += 1;

		const resolved =
			ticket.status === TicketStatus.Closed || ticket.status === TicketStatus.WontFix;

		// archive a resolved, stale thread; skipFlows so retention never fires automation
		if (
			typeof archive_days === 'number' &&
			archive_days > 0 &&
			!ticket.archived &&
			resolved &&
			ticket.updated_at.getTime() < now - archive_days * DAY_MS
		) {
			await patchTicket(id, { archived: true }, env, { skipFlows: true });
			archived += 1;
			continue;
		}

		// coerce; a cache-hit ticket carries archived_at as a serialized string, not a Date
		const purgeReady =
			typeof delete_days === 'number' && delete_days > 0 && ticket.archived && ticket.archived_at;
		const archivedAtMs = purgeReady ? new Date(ticket.archived_at as Date).getTime() : 0;

		// warn assigned staff before a purge; fire once per ticket while the window is closing
		if (purgeReady) {
			const msLeft = archivedAtMs + delete_days! * DAY_MS - now;
			const daysLeft = Math.ceil(msLeft / DAY_MS);
			if (msLeft > 0 && daysLeft <= 7) {
				const warnKey = `smoke:retention_predelete:${id}`;
				const warned = await kv.get(warnKey).catch(() => null);
				if (!warned) {
					await notifyTicketEvent('pre_delete', ticket, env, { daysLeft }).catch(() => {});
					// suppress re-warning until the window nearly elapses
					await kv
						.set(warnKey, '1', { ttl: Math.max(3600, Math.floor(msLeft / 1000)) })
						.catch(() => {});
				}
			}
		}

		// purge for good only when a positive delete window is set (null/0 = never)
		// deleteTicket fires the 'deleted' notification itself, so retention never double-sends
		if (purgeReady && archivedAtMs < now - delete_days! * DAY_MS) {
			await deleteTicket(id, env);
			deleted += 1;
		}
	}

	return { scanned, archived, deleted };
}

export default defineTask({
	meta: {
		name: 'retention:cleanup',
		description: 'Archive resolved stale tickets and purge long-archived tickets per settings'
	},
	async run(): Promise<{ result: Record<string, unknown> }> {
		// secrets come from process.env (text bindings under nodejs_compat); db/kv are hub bindings
		const env = {
			MASTER_KEY: process.env.MASTER_KEY,
			HMAC_SECRET: process.env.HMAC_SECRET
		} as any;

		// missing secrets -> cannot decrypt/hydrate; skip quietly so a deploy never breaks
		if (!env.MASTER_KEY || !env.HMAC_SECRET) {
			return { result: { processed: 0, skipped: 'not-configured' } };
		}

		try {
			ensureCollegeDB(env);
			const out = await runRetention(env);
			return { result: out };
		} catch (error) {
			console.warn('scheduled retention cleanup failed', error);
			return { result: { processed: 0, error: String(error) } };
		}
	}
});
