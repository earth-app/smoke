import type { Ticket } from '~/shared/types/ticket';

export type TicketNotificationEvent =
	'message' | 'closed' | 'reopened' | 'archived' | 'pre_delete' | 'deleted';

type NotifyOpts = { actorId?: string; message?: string; daysLeft?: number };

type Audience = 'customer' | 'agent';

// events that only concern staff; the customer is never told about a retention purge
const STAFF_ONLY: TicketNotificationEvent[] = ['pre_delete', 'deleted'];

const threadKey = (ticketId: number) => `smoke:email_thread:${ticketId}`;

// trim + collapse a message body into a short single-line preview
function snippet(message?: string): string {
	if (!message) return '';
	const clean = message.replace(/\s+/g, ' ').trim();
	return clean.length > 200 ? `${clean.slice(0, 200)}...` : clean;
}

function subjectFor(event: TicketNotificationEvent, ticket: Ticket): string {
	const tag = `Ticket #${ticket.id}`;
	switch (event) {
		case 'message':
			return `New Message on ${tag}: ${ticket.title}`;
		case 'closed':
			return `${tag} Closed: ${ticket.title}`;
		case 'reopened':
			return `${tag} Reopened: ${ticket.title}`;
		case 'archived':
			return `${tag} Archived: ${ticket.title}`;
		case 'pre_delete':
			return `${tag} Scheduled for Deletion: ${ticket.title}`;
		case 'deleted':
			return `${tag} Deleted: ${ticket.title}`;
	}
}

function bodyFor(
	event: TicketNotificationEvent,
	ticket: Ticket,
	link: string,
	audience: Audience,
	opts?: NotifyOpts
): string {
	const isCustomer = audience === 'customer';
	const item = isCustomer
		? `your request "${ticket.title}" (#${ticket.id})`
		: `ticket #${ticket.id} "${ticket.title}"`;
	const Item = isCustomer
		? `Your request "${ticket.title}" (#${ticket.id})`
		: `Ticket #${ticket.id} "${ticket.title}"`;
	const cta = isCustomer ? `View and reply here: ${link}` : `Open the ticket: ${link}`;

	switch (event) {
		case 'message': {
			const snip = snippet(opts?.message);
			const quote = snip ? `\n\n"${snip}"` : '';
			return `There is a new message on ${item}.${quote}\n\n${cta}`;
		}
		case 'closed':
			return `${Item} has been closed.${isCustomer ? ' If you still need help, reply to this email to reopen it.' : ''}\n\n${cta}`;
		case 'reopened':
			return `${Item} has been reopened.\n\n${cta}`;
		case 'archived':
			return `${Item} has been archived.\n\n${cta}`;
		case 'pre_delete': {
			const days = typeof opts?.daysLeft === 'number' ? opts.daysLeft : 7;
			const unit = days === 1 ? 'day' : 'days';
			return `${Item} is scheduled to be permanently deleted in ${days} ${unit} per the retention policy.\n\n${cta}`;
		}
		case 'deleted':
			return `${Item} has been permanently deleted per the retention policy.`;
	}
}

// notify the customer + assigned agents about a ticket event. skips email-thread tickets (those
// already get the live email mirror) and skips the actor who triggered it. must never throw
export async function notifyTicketEvent(
	event: TicketNotificationEvent,
	ticket: Ticket,
	env: any,
	opts?: NotifyOpts
): Promise<void> {
	try {
		// an email-thread ticket already mirrors every reply over smtp; don't double-notify
		const thread = await kv.get(threadKey(ticket.id), 'json');
		if (thread != null) return;

		const settings = await getEmailSettings();
		if (settings.notifications === false) return;

		const rawSite = settings.site_url || env?.NUXT_PUBLIC_SITE_URL || '';
		const site = String(rawSite).replace(/\/$/, '');

		const staffOnly = STAFF_ONLY.includes(event);

		const recipients: { email: string; audience: Audience }[] = [];

		// the customer (kept off retention/staff-only events)
		if (!staffOnly && ticket.customer_id) {
			const customer = await getCustomerById(ticket.customer_id, env).catch(() => null);
			if (customer?.email) recipients.push({ email: customer.email, audience: 'customer' });
		}

		// assigned agents, minus whoever triggered the event
		for (const assignee of ticket.assignees ?? []) {
			if (opts?.actorId && assignee.id === opts.actorId) continue;
			if (assignee.email) recipients.push({ email: assignee.email, audience: 'agent' });
		}

		// de-dupe by address (case-insensitive); first audience wins
		const seen = new Set<string>();
		for (const recipient of recipients) {
			const key = recipient.email.trim().toLowerCase();
			if (!key || seen.has(key)) continue;
			seen.add(key);

			const link =
				recipient.audience === 'customer'
					? `${site}/status/${await hmacSha256(env.HMAC_SECRET, `status:${ticket.id}`)}?id=${ticket.id}`
					: `${site}/dashboard/tickets/${ticket.id}`;

			const subject = subjectFor(event, ticket);
			const body = bodyFor(event, ticket, link, recipient.audience, opts);
			// one failed recipient never blocks the rest
			await sendCustomerEmail(recipient.email, subject, body, env).catch(() => {});
		}
	} catch {
		// notifications are best-effort; never break the triggering action
	}
}
