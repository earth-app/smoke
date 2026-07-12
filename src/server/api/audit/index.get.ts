import type { DBAuditLog } from 'hub:db:schema';
import { ensureCollegeDB } from 'hub:db:schema';
import { Permission } from '~/shared/types/user';

// non-pii columns the client may sort by
const AUDIT_SORT_FIELDS = ['created_at', 'action', 'actor_id', 'ticket_id', 'priority'];

function parseContext(context: string | null): Record<string, unknown> | null {
	if (!context) return null;
	try {
		return JSON.parse(context) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
	if (value == null || value === '') return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
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

	const { search, page, limit, offset, sort, sort_direction } = query(event, AUDIT_SORT_FIELDS);
	const raw = getQuery(event);

	const { results, total } = await listAudit(env, {
		search: search || undefined,
		action: optionalString(raw.action),
		actorId: optionalString(raw.actor_id),
		ticketId: optionalNumber(raw.ticket_id),
		priority: optionalString(raw.priority),
		from: optionalNumber(raw.from),
		to: optionalNumber(raw.to),
		sort: sort as keyof DBAuditLog,
		sort_direction,
		offset,
		limit
	});

	// parse the json context server-side so the client renders it without extra work
	const parsed = results.map((row) => ({ ...row, context: parseContext(row.context) }));

	return { results: parsed, total, page, limit };
});
