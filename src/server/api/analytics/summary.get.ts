import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { TicketPriority, TicketStatus } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';

const rangeSchema = z.object({
	range: z.enum(['7d', '30d', '90d', 'all']).default('30d')
});

const RANGE_DAYS: Record<string, number | null> = {
	'7d': 7,
	'30d': 30,
	'90d': 90,
	all: null
};

// created_at may arrive as a Date, an iso string, or unix seconds; normalize to ms
function toMillis(value: unknown): number {
	if (value instanceof Date) return value.getTime();
	if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
	if (typeof value === 'string') {
		const asNumber = Number(value);
		if (Number.isFinite(asNumber)) return asNumber < 1e12 ? asNumber * 1000 : asNumber;
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function dayKey(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageTicket)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const { range } = rangeSchema.parse(getQuery(event));

	return await cache(
		`smoke:cache:analytics:${range}`,
		async () => {
			const tickets = await listTickets(env, '', 1, 100, 0, 'created_at', 'desc', current);

			const days = RANGE_DAYS[range];
			const now = Date.now();
			const cutoff = days == null ? 0 : now - days * 24 * 60 * 60 * 1000;

			const inRange = tickets.filter((ticket) => toMillis(ticket.created_at) >= cutoff);

			const byStatus = Object.fromEntries(
				Object.values(TicketStatus).map((status) => [status, 0])
			) as Record<TicketStatus, number>;
			const byPriority = Object.fromEntries(
				Object.values(TicketPriority).map((priority) => [priority, 0])
			) as Record<TicketPriority, number>;

			const volumeMap = new Map<string, number>();
			const assigneeMap = new Map<string, number>();

			for (const ticket of inRange) {
				byStatus[ticket.status] = (byStatus[ticket.status] ?? 0) + 1;
				byPriority[ticket.priority] = (byPriority[ticket.priority] ?? 0) + 1;

				const key = dayKey(toMillis(ticket.created_at));
				volumeMap.set(key, (volumeMap.get(key) ?? 0) + 1);

				for (const assignee of ticket.assignees) {
					assigneeMap.set(assignee.id, (assigneeMap.get(assignee.id) ?? 0) + 1);
				}
			}

			const total = inRange.length;
			const resolved = (byStatus[TicketStatus.Closed] ?? 0) + (byStatus[TicketStatus.WontFix] ?? 0);
			const open = total - resolved;

			const volumeByDay = Array.from(volumeMap.entries())
				.map(([date, count]) => ({ date, count }))
				.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

			const perAssignee = Array.from(assigneeMap.entries())
				.map(([id, count]) => ({ id, count }))
				.sort((a, b) => b.count - a.count);

			// share of tickets that originated from an email thread (kv thread index present)
			let emailCount = 0;
			await Promise.all(
				inRange.map(async (ticket) => {
					const thread = await kv.get<string>(`smoke:email_thread:${ticket.id}`);
					if (thread) emailCount += 1;
				})
			);
			const emailChannelShare = total > 0 ? emailCount / total : 0;

			return {
				range,
				total,
				by_status: byStatus,
				by_priority: byPriority,
				open,
				resolved,
				volume_by_day: volumeByDay,
				per_assignee: perAssignee,
				email_channel_share: emailChannelShare
			};
		},
		60
	);
});
