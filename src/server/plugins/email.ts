export default defineNitroPlugin((nitro) => {
	nitro.hooks.hook('cloudflare:email', async ({ message, env, context }) => {
		void context;

		// degrade calmly when the email engine isn't fully configured
		if (!isEmailConfigured(env)) {
			await replyNotConfigured(message).catch((error) =>
				console.warn('Failed to send not-configured reply', error)
			);
			return;
		}

		let parsed;
		try {
			parsed = await parseInboundEmail(message);
		} catch (error) {
			console.error('Failed to parse inbound email', error);
			return;
		}

		if (!parsed?.from) {
			try {
				message.setReject?.('Unable to parse sender address');
			} catch {
				// reject is best-effort
			}
			return;
		}

		const existingCustomer = await getCustomerByEmail(parsed.from, env);
		const customer =
			existingCustomer ??
			(await createCustomer(
				{ email: parsed.from, name: parsed.name || parsed.from, tags: [] },
				env
			));

		// thread a reply into its existing ticket, otherwise open a new conversation
		let ticketId = await resolveTicketForInbound(parsed);
		let isNewTicket = false;
		let ticketTitle = parsed.subject;

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
				{ title: parsed.subject, description: parsed.text, customer_id: customer.id },
				env
			);
			ticketId = ticket.id;
			ticketTitle = ticket.title;
			isNewTicket = true;
			await initEmailThread(ticketId, parsed.subject, parsed.from);
		}

		if (parsed.messageId) await indexMessageId(parsed.messageId, ticketId);
		await recordInboundOnThread(ticketId, parsed);

		if (isNewTicket) {
			const state = await ensureThreadVerification(parsed.from, ticketId, env);
			await sendAutoAck(message, parsed, ticketId, ticketTitle, state, env).catch((error) =>
				console.warn('Failed to send auto-ack reply', error)
			);
		}

		await reapStaleUnverified(env).catch(() => {
			// reaper is best-effort
		});
	});
});
