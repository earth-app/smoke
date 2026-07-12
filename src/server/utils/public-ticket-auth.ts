type PublicTicketWriteOpts = {
	tokenOk: boolean;
	sessionCustomer: { id: number; email?: string } | null;
	ticket: { customer_id: number; participants?: string[] };
	env: any;
};

export async function authorizePublicTicketWrite(opts: PublicTicketWriteOpts): Promise<void> {
	const { tokenOk, sessionCustomer, ticket, env } = opts;

	// an owning customer session is always allowed
	if (sessionCustomer && ticket.customer_id === sessionCustomer.id) return;

	// a signed-in customer who is a participant may also reply, even on a private ticket
	if (
		sessionCustomer?.email &&
		(ticket.participants ?? []).includes(sessionCustomer.email.trim().toLowerCase())
	)
		return;

	// otherwise the magic-link token must be valid
	if (!tokenOk) {
		throw createError({ statusCode: 403, message: 'Invalid Status Token' });
	}

	// and the ticket must have a real customer to reply as
	const hasCustomer = ticket.customer_id > 0 && !!(await getCustomerById(ticket.customer_id, env));
	if (!hasCustomer) {
		throw createError({
			statusCode: 403,
			message: 'This ticket has no registered customer to reply to'
		});
	}
}
