// optional inbound poll for self-hosters not on cloudflare email routing (imap/pop3)
export async function pollInboundMailbox(env: any): Promise<{ processed: number }> {
	const config = await getInboundPollConfig(env);
	if (!config) return { processed: 0 };

	const { protocol, connectOptions, support } = config;
	let processed = 0;

	// lazy-import edgeport so the #server-utils test barrel never pulls cloudflare:sockets
	try {
		if (protocol === 'pop3') {
			const { connect } = await import('edgeport/pop3');
			const session = await connect(connectOptions as any);
			try {
				const { count } = await session.stat();
				for (let n = 1; n <= count; n += 1) {
					try {
						const bytes = await session.retrieve(n);
						if (await handleRawMessage(bytes, support, env)) processed += 1;
					} catch (error) {
						console.warn('Failed to process pop3 message', n, error);
					}
				}
			} finally {
				await session.close().catch(() => {});
			}
		} else {
			const { connect } = await import('edgeport/imap');
			const session = await connect(connectOptions as any);
			try {
				await session.select('INBOX');
				const uids = await session.search({ unseen: true });
				const msgs = await session.fetch(uids, { body: true });
				for (const msg of msgs) {
					try {
						if (!msg.body) continue; // skip if no body (shouldn't happen)
						if (await handleRawMessage(msg.body, support, env)) processed += 1;
					} catch (error) {
						console.warn('Failed to process imap message', error);
					}
				}
			} finally {
				await session.close().catch(() => {});
			}
		}
	} catch (error) {
		// non-throwing at the top level; a connect/list failure just yields whatever we processed
		console.warn('Inbound poll failed', error);
	}

	return { processed };
}

// pull the recipient from the raw To header so reply aliases (support+t<id>@) thread on poll;
// polled mail has no envelope recipient, so the base support address is the fallback
function extractRecipient(raw: Uint8Array | string, fallback: string): string {
	const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
	const match = text.match(/^to:[ \t]*(.*)$/im);
	if (!match) return fallback;
	const value = match[1] ?? '';
	const addr = value.match(/<([^>]+)>/)?.[1] ?? value;
	return addr.trim() || fallback;
}

// parse one raw rfc822 message and thread it into a ticket; returns true when handled
async function handleRawMessage(
	raw: Uint8Array | string,
	support: string,
	env: any
): Promise<boolean> {
	// loop guard: skip our own outbound if the polled mailbox also receives sent copies
	const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
	const head = text.split(/\r?\n\r?\n/)[0] ?? '';
	if (new RegExp(`^${OUTBOUND_MARKER_HEADER}:`, 'im').test(head)) return false;

	const parsed = await parseInboundEmail({
		raw,
		from: '',
		to: extractRecipient(raw, support),
		headers: new Headers()
	});
	if (!parsed?.from) return false;

	// dedup: skip a message-id we already indexed
	if (parsed.messageId) {
		const existing = await resolveTicketForInbound({
			...parsed,
			to: '',
			references: [],
			inReplyTo: parsed.messageId
		}).catch(() => null);
		if (existing) return false;
	}

	const existingTicketId = await resolveTicketForInbound(parsed);

	const existingCustomer = await getCustomerByEmail(parsed.from, env);
	const customer =
		existingCustomer ??
		(await createCustomer({ email: parsed.from, name: parsed.name || parsed.from, tags: [] }, env));

	let ticketId = existingTicketId;
	if (ticketId) {
		await addTicketMessage(
			ticketId,
			{
				message: parsed.text,
				sender: { kind: 'customer', id: customer.id, email: parsed.from, name: parsed.name }
			},
			env
		);
	} else {
		const ticket = await createTicket(
			{
				title: parsed.subject,
				description: parsed.text,
				customer_id: customer.id,
				source: 'emailed'
			},
			env
		);
		ticketId = ticket.id;
		await initEmailThread(ticketId, parsed.subject, parsed.from);
	}

	if (parsed.messageId) await indexMessageId(parsed.messageId, ticketId);
	await recordInboundOnThread(ticketId, parsed);
	await captureInboundParticipants(ticketId, parsed, env);

	return true;
}
