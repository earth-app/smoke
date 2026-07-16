import { send as edgeportSend } from 'edgeport/smtp';
import { describe, expect, it, vi } from 'vitest';
import { TicketVisibility } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';
import { getRuntime } from '../api/route-runtime';

// emailed tickets default to private now; list as a privileged viewer to see them in these specs
const PRIV_VIEWER = { id: 'sys', permissions: [Permission.ViewPrivateTickets] } as any;

// edgeport opens real TCP sockets; mock it so the outbound path is observable without a network
vi.mock('edgeport/smtp', () => ({
	send: vi.fn(async () => ({ accepted: [], response: '250 OK' }))
}));

type EmailHandler = (payload: { message: any; env: any; context: unknown }) => Promise<void>;

async function loadEmailHandler(): Promise<EmailHandler> {
	const plugin = (await import('~/server/plugins/email')).default;
	let handler: EmailHandler | undefined;
	plugin({
		hooks: {
			hook: (name: string, fn: EmailHandler) => {
				if (name === 'cloudflare:email') {
					handler = fn;
				}
			}
		}
	} as any);
	if (!handler) throw new Error('cloudflare:email hook was not registered');
	return handler;
}

type BuildMessageOptions = {
	from: string;
	to?: string;
	subject?: string;
	messageId?: string;
	inReplyTo?: string;
	references?: string;
	body?: string;
};

function buildMessage(options: BuildMessageOptions) {
	const to = options.to ?? 'support@smoke.example.com';
	const lines = [
		`From: ${options.from}`,
		`To: ${to}`,
		options.subject ? `Subject: ${options.subject}` : undefined,
		options.messageId ? `Message-ID: ${options.messageId}` : undefined,
		options.inReplyTo ? `In-Reply-To: ${options.inReplyTo}` : undefined,
		options.references ? `References: ${options.references}` : undefined,
		'Content-Type: text/plain; charset=utf-8',
		'',
		options.body ?? 'Email body.'
	].filter((line): line is string => line !== undefined);

	const headers = new Headers();
	if (options.subject) headers.set('subject', options.subject);
	if (options.messageId) headers.set('message-id', options.messageId);
	if (options.inReplyTo) headers.set('in-reply-to', options.inReplyTo);
	if (options.references) headers.set('references', options.references);

	const envelopeFrom = (options.from.match(/<([^>]+)>/)?.[1] ?? options.from).trim();

	return {
		from: envelopeFrom,
		to,
		headers,
		raw: lines.join('\r\n'),
		reply: vi.fn(async () => ({})),
		setReject: vi.fn()
	};
}

describe('cloudflare:email plugin', () => {
	it('creates a customer + ticket and auto-acks an unknown sender', async () => {
		const runtime = getRuntime();
		const handler = await loadEmailHandler();

		const message = buildMessage({
			from: '"New User" <new@example.com>',
			subject: 'Support needed',
			messageId: '<u1@example.com>',
			body: 'Please help me with account setup.'
		});
		await handler({ message, env: runtime.env, context: {} });

		const utils = await import('#server-utils');
		const customer = await utils.getCustomerByEmail('new@example.com', runtime.env);
		expect(customer?.email).toBe('new@example.com');
		expect(customer?.name).toBe('New User');

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(1);
		expect(tickets[0]?.title).toBe('Support needed');
		expect(tickets[0]?.description).toBe('Please help me with account setup.');
		expect(tickets[0]?.customer_id).toBe(customer!.id);

		expect(message.reply).toHaveBeenCalledTimes(1);
	});

	it('reuses an existing customer instead of creating a duplicate', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const existing = await utils.createCustomer(
			{ name: 'Existing', email: 'existing@example.com' },
			runtime.env
		);

		const handler = await loadEmailHandler();
		await handler({
			message: buildMessage({
				from: 'existing@example.com',
				subject: 'Reply',
				body: 'still need help'
			}),
			env: runtime.env,
			context: {}
		});

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(1);
		expect(tickets[0]?.customer_id).toBe(existing.id);
	});

	it('threads a reply into the existing ticket via the reply alias', async () => {
		const runtime = getRuntime();
		const handler = await loadEmailHandler();
		const utils = await import('#server-utils');

		await handler({
			message: buildMessage({
				from: 'thread@example.com',
				subject: 'Broken login',
				body: 'cannot log in'
			}),
			env: runtime.env,
			context: {}
		});

		// customer replies to support+t1@... which routes the mail straight back to the ticket
		await handler({
			message: buildMessage({
				from: 'thread@example.com',
				to: 'support+t1@smoke.example.com',
				subject: 'Re: Broken login',
				body: 'here is more detail'
			}),
			env: runtime.env,
			context: {}
		});

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(1);

		const thread = await utils.getTicketThread(1, runtime.env, PRIV_VIEWER);
		expect(thread.messages).toHaveLength(1);
		expect(thread.messages[0]?.message).toBe('here is more detail');
		expect(thread.messages[0]?.sender.kind).toBe('customer');
	});

	it('threads a reply via In-Reply-To when the alias is absent', async () => {
		const runtime = getRuntime();
		const handler = await loadEmailHandler();
		const utils = await import('#server-utils');

		await handler({
			message: buildMessage({
				from: 'header@example.com',
				subject: 'Need help',
				messageId: '<orig-1@example.com>',
				body: 'initial'
			}),
			env: runtime.env,
			context: {}
		});

		await handler({
			message: buildMessage({
				from: 'header@example.com',
				subject: 'Re: Need help',
				inReplyTo: '<orig-1@example.com>',
				body: 'follow-up over email'
			}),
			env: runtime.env,
			context: {}
		});

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(1);

		const thread = await utils.getTicketThread(1, runtime.env, PRIV_VIEWER);
		expect(thread.messages).toHaveLength(1);
		expect(thread.messages[0]?.message).toBe('follow-up over email');
	});

	it('threads a reply via the References chain when alias + In-Reply-To are absent', async () => {
		const runtime = getRuntime();
		const handler = await loadEmailHandler();
		const utils = await import('#server-utils');

		await handler({
			message: buildMessage({
				from: 'refs@example.com',
				subject: 'Need help',
				messageId: '<orig-ref-1@example.com>',
				body: 'initial'
			}),
			env: runtime.env,
			context: {}
		});

		// reply carries only a References header pointing at the original message-id
		await handler({
			message: buildMessage({
				from: 'refs@example.com',
				subject: 'Re: Need help',
				references: '<orig-ref-1@example.com>',
				body: 'reply via references chain'
			}),
			env: runtime.env,
			context: {}
		});

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(1);

		const thread = await utils.getTicketThread(1, runtime.env, PRIV_VIEWER);
		expect(thread.messages).toHaveLength(1);
		expect(thread.messages[0]?.message).toBe('reply via references chain');
		expect(thread.messages[0]?.sender.kind).toBe('customer');
	});

	it('replies with a not-configured notice and creates nothing when secrets are missing', async () => {
		const runtime = getRuntime();
		const handler = await loadEmailHandler();
		const utils = await import('#server-utils');

		const message = buildMessage({ from: 'someone@example.com', subject: 'Hello', body: 'hi' });
		await handler({
			message,
			env: { ...runtime.env, CF_API_TOKEN: '', CF_EMAIL_TOKEN: '', SUPPORT_EMAIL: '' },
			context: {}
		});

		expect(message.reply).toHaveBeenCalledTimes(1);

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(0);
		expect(await utils.getCustomerByEmail('someone@example.com', runtime.env)).toBeNull();
	});

	it('rejects an inbound message without a parseable sender', async () => {
		const runtime = getRuntime();
		const handler = await loadEmailHandler();
		const utils = await import('#server-utils');

		const message = buildMessage({ from: '', subject: 'Ignored', body: 'ignored' });
		message.from = '';
		await handler({ message, env: runtime.env, context: {} });

		expect(message.setReject).toHaveBeenCalledTimes(1);
		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(0);
	});
});

describe('sendTicketEmailReply (Email Service via edgeport)', () => {
	it('sends a threaded reply to any customer over edgeport SMTP', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');

		const email = 'anyone@example.com';
		const customer = await utils.createCustomer({ name: 'Anyone', email }, runtime.env);
		const ticket = await utils.createTicket(
			{ title: 'Login issue', description: 'cannot log in', customer_id: customer.id },
			runtime.env
		);
		await utils.initEmailThread(ticket.id, 'Login issue', email);
		await utils.recordInboundOnThread(ticket.id, {
			from: email,
			to: '',
			subject: 'Login issue',
			messageId: '<cust-1@example.com>',
			references: [],
			text: 'cannot log in'
		});

		const sent = await utils.sendTicketEmailReply(
			ticket.id,
			'can you send a screenshot?',
			runtime.env
		);
		expect(sent).toBe(true);

		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		expect(sendMock).toHaveBeenCalledTimes(1);
		const call = sendMock.mock.calls[0]![0];
		expect(call.hostname).toBe('smtp.mx.cloudflare.net');
		expect(call.tls).toBe('implicit');
		expect(call.auth.username).toBe('api_token');
		expect(call.auth.password).toBe('cf-api-token');
		expect(call.to).toBe(email);
		expect(call.text).toBe('can you send a screenshot?');
		// clean onboarded From, alias Reply-To, threaded against the customer's last message
		expect(call.from).toContain('support@smoke.example.com');
		expect(call.headers['Reply-To']).toBe('support+t' + ticket.id + '@smoke.example.com');
		expect(call.headers['In-Reply-To']).toBe('<cust-1@example.com>');
	});

	it('forwards attachments on an agent reply over edgeport SMTP', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		sendMock.mockClear();

		const email = 'attach@example.com';
		const customer = await utils.createCustomer({ name: 'Attach', email }, runtime.env);
		const ticket = await utils.createTicket(
			{ title: 'With file', description: 'see attached', customer_id: customer.id },
			runtime.env
		);
		await utils.initEmailThread(ticket.id, 'With file', email);

		const sent = await utils.sendTicketEmailReply(ticket.id, 'here you go', runtime.env, [
			{ file_name: 'note.txt', mimetype: 'text/plain', data: btoa('hello world') }
		]);
		expect(sent).toBe(true);

		const call = sendMock.mock.calls[0]![0];
		expect(call.attachments).toHaveLength(1);
		expect(call.attachments[0].filename).toBe('note.txt');
		expect(call.attachments[0].contentType).toBe('text/plain');
		expect(new TextDecoder().decode(call.attachments[0].content)).toBe('hello world');
	});

	it('does not send for a ticket that is not email-linked', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		sendMock.mockClear();

		const customer = await utils.createCustomer(
			{ name: 'No Email', email: 'no@example.com' },
			runtime.env
		);
		const ticket = await utils.createTicket(
			{ title: 'UI ticket', description: 'opened in ui', customer_id: customer.id },
			runtime.env
		);

		const sent = await utils.sendTicketEmailReply(ticket.id, 'reply', runtime.env);
		expect(sent).toBe(false);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it('still mirrors on a private email thread (customer opened it by email)', async () => {
		// privacy restricts staff visibility, not replies to the customer who started the thread
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		sendMock.mockClear();

		const email = 'priv@example.com';
		const customer = await utils.createCustomer({ name: 'Priv', email }, runtime.env);
		const ticket = await utils.createTicket(
			{ title: 'Private', description: 'secret', customer_id: customer.id, private: true },
			runtime.env
		);
		await utils.initEmailThread(ticket.id, 'Private', email);

		const sent = await utils.sendTicketEmailReply(ticket.id, 'here is your answer', runtime.env);
		expect(sent).toBe(true);
		expect(sendMock).toHaveBeenCalledTimes(1);
		expect(sendMock.mock.calls[0]![0].to).toBe(email);
	});

	it('auto-ccs participants (excluding the primary customer) on a reply', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		sendMock.mockClear();

		const email = 'primary@example.com';
		const customer = await utils.createCustomer({ name: 'Primary', email }, runtime.env);
		const ticket = await utils.createTicket(
			{ title: 'CC thread', description: 'x', customer_id: customer.id },
			runtime.env
		);
		await utils.initEmailThread(ticket.id, 'CC thread', email);
		await utils.addTicketParticipant(ticket.id, 'watcher@example.com', runtime.env);

		const sent = await utils.sendTicketEmailReply(ticket.id, 'reply body', runtime.env);
		expect(sent).toBe(true);
		const call = sendMock.mock.calls[sendMock.mock.calls.length - 1]![0];
		expect(call.to).toBe(email);
		expect(call.cc).toEqual(['watcher@example.com']);
	});

	it('still sends with no cc when the ticket has no participants', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		sendMock.mockClear();

		const email = 'solo@example.com';
		const customer = await utils.createCustomer({ name: 'Solo', email }, runtime.env);
		const ticket = await utils.createTicket(
			{ title: 'Solo thread', description: 'x', customer_id: customer.id },
			runtime.env
		);
		await utils.initEmailThread(ticket.id, 'Solo thread', email);

		const sent = await utils.sendTicketEmailReply(ticket.id, 'reply body', runtime.env);
		expect(sent).toBe(true);
		const call = sendMock.mock.calls[sendMock.mock.calls.length - 1]![0];
		expect(call.to).toBe(email);
		expect(call.cc).toBeUndefined();
	});
});

describe('inbound participant capture', () => {
	it('parseInboundEmail exposes cc + recipients as normalized arrays', async () => {
		const utils = await import('#server-utils');
		const raw = [
			'From: "Sender" <sender@example.com>',
			'To: support@smoke.example.com, watcher@example.com',
			'Cc: cc1@example.com, "CC Two" <CC2@Example.com>',
			'Subject: Multi recipient',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'hello'
		].join('\r\n');

		const parsed = await utils.parseInboundEmail({
			raw,
			from: 'sender@example.com',
			to: 'support@smoke.example.com',
			headers: new Headers()
		});
		expect(parsed?.recipients).toEqual(
			expect.arrayContaining(['support@smoke.example.com', 'watcher@example.com'])
		);
		expect(parsed?.cc).toEqual(expect.arrayContaining(['cc1@example.com', 'cc2@example.com']));
	});

	it('captureInboundParticipants adds cc/recipients but skips support, alias, from, and the customer', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const customer = await utils.createCustomer(
			{ name: 'Cust', email: 'cust@example.com' },
			runtime.env
		);
		const ticket = await utils.createTicket(
			{
				title: 'Cap',
				description: 'x',
				customer_id: customer.id,
				visibility: TicketVisibility.Private
			},
			runtime.env
		);

		await utils.captureInboundParticipants(
			ticket.id,
			{
				from: 'cust@example.com',
				to: 'support@smoke.example.com',
				recipients: [
					'support@smoke.example.com',
					`support+t${ticket.id}@smoke.example.com`,
					'teammate@example.com'
				],
				cc: ['cust@example.com', 'watcher@example.com'],
				subject: 'x',
				references: [],
				text: 'hi'
			},
			runtime.env
		);

		const participants = await utils.getTicketParticipants(ticket.id);
		expect(participants).toEqual(
			expect.arrayContaining(['teammate@example.com', 'watcher@example.com'])
		);
		expect(participants).not.toContain('support@smoke.example.com');
		expect(participants).not.toContain('cust@example.com');
		expect(participants.some((p: string) => p.includes('+t'))).toBe(false);
	});
});

describe('automated / bounce inbound', () => {
	// regression: a cloudflare bounce (support address does not exist) hit the hook, which tried to
	// reply to the bounce address and 550'd. bounces must be dropped: no ticket, no reply
	it('ignores a cloudflare bounce: no ticket and no reply', async () => {
		const runtime = getRuntime();
		const handler = await loadEmailHandler();

		const message = buildMessage({
			from: 'bounces@cf-bounce.notify.cloudflare.com',
			subject: 'Delivery failure',
			messageId: '<bounce1@cf>',
			body: 'permanent error (550): 5.1.1 Address does not exist'
		});
		await handler({ message, env: runtime.env, context: {} });

		const utils = await import('#server-utils');
		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(0);
		expect(message.reply).not.toHaveBeenCalled();
	});

	it('detects bounce/daemon/no-reply addresses and automation headers', async () => {
		const { isAutomatedInbound, isAutomatedSenderAddress } = await import('~/server/utils/email');

		expect(isAutomatedSenderAddress('bounces@cf-bounce.notify.cloudflare.com')).toBe(true);
		expect(isAutomatedSenderAddress('MAILER-DAEMON@mail.example.com')).toBe(true);
		expect(isAutomatedSenderAddress('no-reply@shop.example.com')).toBe(true);
		// empty/unparseable is NOT classified here (the cloudflare hook setReject's it instead)
		expect(isAutomatedSenderAddress('')).toBe(false);
		expect(isAutomatedSenderAddress('alice@example.com')).toBe(false);

		const autoReplied = new Headers();
		autoReplied.set('auto-submitted', 'auto-replied');
		expect(isAutomatedInbound({ from: 'alice@example.com', headers: autoReplied })).toBe(true);

		const bulk = new Headers();
		bulk.set('precedence', 'bulk');
		expect(isAutomatedInbound({ from: 'alice@example.com', headers: bulk })).toBe(true);

		expect(isAutomatedInbound({ from: 'alice@example.com', headers: new Headers() })).toBe(false);
	});
});
