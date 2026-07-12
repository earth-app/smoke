export default defineNitroPlugin((nitro) => {
	nitro.hooks.hook('cloudflare:email', async ({ message, env, context }) => {
		void context;

		// degrade calmly when the email engine isn't fully configured
		if (!(await isEmailConfigured(env))) {
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

		// existing ticket + a linked agent sender -> an agent reply from their own mailbox
		const existingTicketId = await resolveTicketForInbound(parsed);
		if (existingTicketId) {
			const agentId = await resolveAgentByEmail(env, parsed.from);
			if (agentId) {
				await appendAgentEmailReply(existingTicketId, agentId, parsed, env);
				if (parsed.messageId) await indexMessageId(parsed.messageId, existingTicketId);
				await recordInboundOnThread(existingTicketId, parsed);
				return;
			}
		}

		const existingCustomer = await getCustomerByEmail(parsed.from, env);
		const customer =
			existingCustomer ??
			(await createCustomer(
				{ email: parsed.from, name: parsed.name || parsed.from, tags: [] },
				env
			));

		let ticketId = existingTicketId;
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
				{
					title: parsed.subject,
					description: parsed.text,
					customer_id: customer.id,
					source: 'emailed'
				},
				env
			);
			ticketId = ticket.id;
			ticketTitle = ticket.title;
			isNewTicket = true;
			await initEmailThread(ticketId, parsed.subject, parsed.from);
		}

		if (parsed.messageId) await indexMessageId(parsed.messageId, ticketId);
		await recordInboundOnThread(ticketId, parsed);
		// cc'd / additional To addresses become participants (new-ticket + threaded-reply branches)
		await captureInboundParticipants(ticketId, parsed, env);

		if (isNewTicket) {
			await sendAutoAck(message, parsed, ticketId, ticketTitle, env).catch((error) =>
				console.warn('Failed to send auto-ack reply', error)
			);
		}

		// forward the customer message to assignees / team inbox so agents can reply from their mailbox
		await forwardToAgents(ticketId, parsed, env).catch((error) =>
			console.warn('Failed to forward inbound email to agents', error)
		);
	});
});
