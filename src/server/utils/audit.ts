import { allAllShardsGlobal, run, runAllShards } from '@earth-app/collegedb';
import type { DBAuditLog } from 'hub:db:schema';
import { ensureCollegeDB } from 'hub:db:schema';

export type AuditPriority = 'low' | 'normal' | 'high' | 'critical';

export type AuditEntryInput = {
	action: string;
	actorId?: string | null;
	actorName?: string | null;
	targetType?: string | null;
	targetId?: string | number | null;
	ticketId?: number | null;
	priority?: AuditPriority;
	summary?: string | null;
	context?: Record<string, unknown> | null;
};

// known action strings; the ui uses these to build the filter dropdown (free-form still allowed)
export const AUDIT_ACTIONS = [
	'ticket.created',
	'ticket.updated',
	'ticket.deleted',
	'ticket.message_added',
	'ticket.message_edited',
	'ticket.message_deleted',
	'ticket.participant_added',
	'ticket.participant_removed',
	'customer.created',
	'customer.updated',
	'customer.deleted',
	'customer.magic_link_issued',
	'user.created',
	'user.updated',
	'user.deleted',
	'user.password_changed',
	'label.created',
	'label.updated',
	'label.deleted',
	'settings.updated',
	'auth.login',
	'auth.logout',
	'auth.magic_link_issued'
] as const;

// record one audit entry; best-effort - never throws so it can wrap any mutation without risk
export async function recordAudit(env: any, entry: AuditEntryInput): Promise<void> {
	try {
		ensureCollegeDB(env);
		const createdAt = Math.floor(Date.now() / 1000);
		// omit id so the autoincrement pk assigns it; MAX(id)+1 races under the high write volume of
		// audit rows (every mutation) and collides. a constant routing key keeps the whole log on one
		// shard so the sequence stays monotonic; listAudit/purge fan out across all shards regardless
		await run(
			'audit_log',
			`INSERT INTO audit_log (created_at, action, actor_id, actor_name, target_type, target_id, ticket_id, priority, summary, context)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				createdAt,
				entry.action,
				entry.actorId ?? null,
				entry.actorName ?? null,
				entry.targetType ?? null,
				entry.targetId != null ? String(entry.targetId) : null,
				entry.ticketId ?? null,
				entry.priority ?? 'normal',
				entry.summary ?? null,
				entry.context ? JSON.stringify(entry.context) : null
			]
		);
	} catch (error) {
		// auditing must never break the underlying action
		console.warn('Failed to record audit entry', entry.action, error);
	}
}

export type AuditListFilters = {
	search?: string;
	action?: string;
	actorId?: string;
	ticketId?: number;
	priority?: string;
	// unix seconds inclusive range
	from?: number;
	to?: number;
	sort?: keyof DBAuditLog;
	sort_direction?: 'asc' | 'desc';
	offset?: number;
	limit?: number;
};

export type AuditListResult = { results: DBAuditLog[]; total: number };

// list audit rows across shards with server-side filtering/sort/pagination + a total count
export async function listAudit(env: any, filters: AuditListFilters): Promise<AuditListResult> {
	ensureCollegeDB(env);

	const bindings: Array<string | number> = [];
	const clauses: string[] = [];

	if (filters.search) {
		clauses.push('(summary LIKE ? OR action LIKE ? OR actor_name LIKE ? OR target_id LIKE ?)');
		const like = `%${filters.search}%`;
		bindings.push(like, like, like, like);
	}
	if (filters.action) {
		clauses.push('action = ?');
		bindings.push(filters.action);
	}
	if (filters.actorId) {
		clauses.push('actor_id = ?');
		bindings.push(filters.actorId);
	}
	if (typeof filters.ticketId === 'number') {
		clauses.push('ticket_id = ?');
		bindings.push(filters.ticketId);
	}
	if (filters.priority) {
		clauses.push('priority = ?');
		bindings.push(filters.priority);
	}
	if (typeof filters.from === 'number') {
		clauses.push('created_at >= ?');
		bindings.push(filters.from);
	}
	if (typeof filters.to === 'number') {
		clauses.push('created_at <= ?');
		bindings.push(filters.to);
	}

	const sql = `SELECT * FROM audit_log${clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''}`;
	const result = await allAllShardsGlobal<DBAuditLog>(sql, bindings, {
		sortBy: (filters.sort ?? 'created_at') as keyof DBAuditLog,
		sortDirection: filters.sort_direction ?? 'desc',
		offset: filters.offset ?? 0,
		limit: filters.limit ?? 50,
		includeTotal: true
	});

	const meta = result.meta as { total?: number } | undefined;
	return { results: result.results, total: meta?.total ?? result.results.length };
}

// delete audit rows older than the cutoff (unix seconds); used by the retention task
export async function purgeAuditBefore(env: any, cutoff: number): Promise<void> {
	ensureCollegeDB(env);
	// audit rows are hash-routed by id across shards, so purge must run on every shard
	await runAllShards(`DELETE FROM audit_log WHERE created_at < ?`, [cutoff]).catch((error) => {
		console.warn('Audit purge failed', error);
	});
}
