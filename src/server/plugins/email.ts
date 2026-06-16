function extractEmailAddress(value: unknown): { email: string; name?: string } | null {
	if (!value) {
		return null;
	}

	if (typeof value === 'string') {
		const quotedMatch = value.match(/^(.*)<([^>]+)>$/);
		if (quotedMatch) {
			const [, displayName, emailAddress] = quotedMatch;
			return {
				name: displayName?.trim().replace(/^"|"$/g, '') || undefined,
				email: emailAddress?.trim() || ''
			};
		}

		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? { email: value.trim() } : null;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			const parsed = extractEmailAddress(entry);
			if (parsed) return parsed;
		}

		return null;
	}

	if (typeof value === 'object') {
		const record = value as unknown as Record<string, unknown>;
		const email =
			typeof record.email === 'string'
				? record.email
				: typeof record.address === 'string'
					? record.address
					: typeof record.value === 'string'
						? record.value
						: null;
		if (!email) {
			return null;
		}

		return {
			email: email.trim(),
			name:
				typeof record.name === 'string'
					? record.name
					: typeof record.personal === 'string'
						? record.personal
						: undefined
		};
	}

	return null;
}

function extractEmailBody(message: Record<string, unknown>): string {
	const candidates = [message.text, message.plainText, message.html, message.body, message.content];
	for (const candidate of candidates) {
		if (typeof candidate === 'string' && candidate.trim().length > 0) {
			return candidate.trim();
		}
	}

	return 'Email received.';
}

function extractEmailSubject(message: Record<string, unknown>): string {
	const subject = message.subject;
	if (typeof subject === 'string' && subject.trim().length > 0) {
		return subject.trim();
	}

	return 'New email';
}

export default defineNitroPlugin((nitro) => {
	nitro.hooks.hook('cloudflare:email', async ({ message, env, context }) => {
		void context;

		const rawMessage = message as unknown as Record<string, unknown>;
		const sender = extractEmailAddress(rawMessage.from ?? rawMessage.sender ?? rawMessage.replyTo);
		if (!sender?.email) {
			console.warn('Skipping inbound email without a parseable sender address');
			return;
		}

		const existingCustomer = await getCustomerByEmail(sender.email, env);
		const customer =
			existingCustomer ??
			(await createCustomer(
				{
					email: sender.email,
					name: sender.name || sender.email,
					tags: []
				},
				env
			));

		await createTicket(
			{
				title: extractEmailSubject(rawMessage),
				description: extractEmailBody(rawMessage),
				customer_id: customer.id
			},
			env
		);
	});
});
