import type { DBAuditLog } from 'hub:db:schema';
import { ensureCollegeDB } from 'hub:db:schema';
import { Permission } from '~/shared/types/user';

// non-pii columns the client may sort by
const AUDIT_SORT_FIELDS = ['created_at', 'action', 'actor_id', 'ticket_id', 'priority'];
// hard cap so an export can never scan an unbounded table
const EXPORT_LIMIT = 10000;

const CSV_COLUMNS: Array<keyof DBAuditLog> = [
	'id',
	'created_at',
	'action',
	'actor_id',
	'actor_name',
	'target_type',
	'target_id',
	'ticket_id',
	'priority',
	'summary',
	'context'
];

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	if (value == null || value === '') return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

// rfc4180 cell: quote + double any embedded quotes
function csvCell(value: unknown): string {
	const s = value == null ? '' : String(value);
	return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(rows: DBAuditLog[]): string {
	const header = CSV_COLUMNS.join(',');
	const body = rows.map((row) => CSV_COLUMNS.map((col) => csvCell(row[col])).join(','));
	return [header, ...body].join('\n');
}

function toTxtLine(row: DBAuditLog): string {
	const when = new Date(Number(row.created_at) * 1000).toISOString();
	const who = row.actor_name || row.actor_id || 'system';
	const target = row.ticket_id != null ? ` (ticket #${row.ticket_id})` : '';
	const detail = row.summary ? ` - ${row.summary}` : '';
	return `[${when}] ${row.action} by ${who}${target}${detail}`;
}

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ViewAuditLog)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const raw = getQuery(event);
	const format = raw.format === 'json' ? 'json' : raw.format === 'txt' ? 'txt' : 'csv';

	// reuse the shared search/sort validation; export ignores pagination and pulls up to the cap
	const { search, sort, sort_direction } = primitiveQuery(event, AUDIT_SORT_FIELDS);

	const { results } = await listAudit(env, {
		search: search || undefined,
		action: optionalString(raw.action),
		actorId: optionalString(raw.actor_id),
		ticketId: optionalNumber(raw.ticket_id),
		priority: optionalString(raw.priority),
		from: optionalNumber(raw.from),
		to: optionalNumber(raw.to),
		sort: sort as keyof DBAuditLog,
		sort_direction,
		offset: 0,
		limit: EXPORT_LIMIT
	});

	// stable filename keyed to the newest row so repeat exports don't churn on the clock
	const maxId = results.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);

	let body: string;
	let contentType: string;
	if (format === 'json') {
		const rows = results.map((row) => ({
			...row,
			context: row.context ? safeJson(row.context) : null
		}));
		body = JSON.stringify(rows, null, 2);
		contentType = 'application/json; charset=utf-8';
	} else if (format === 'txt') {
		body = results.map(toTxtLine).join('\n');
		if (results.length > 0) body += '\n';
		contentType = 'text/plain; charset=utf-8';
	} else {
		body = toCsv(results);
		contentType = 'text/csv; charset=utf-8';
	}

	const filename = `audit-${maxId || results.length}.${format}`;

	// mirror the avatar route's node.res header pattern; guarded so unit tests without a res are safe
	const res = event.node?.res;
	if (res?.setHeader) {
		res.setHeader('Content-Type', contentType);
		res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
		res.setHeader('Cache-Control', 'no-store');
	}

	return body;
});

function safeJson(context: string): Record<string, unknown> | null {
	try {
		return JSON.parse(context) as Record<string, unknown>;
	} catch {
		return null;
	}
}
