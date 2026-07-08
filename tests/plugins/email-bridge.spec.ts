import { send as edgeportSend } from 'edgeport/smtp';
import { describe, expect, it, vi } from 'vitest';
import { getRuntime, seedCustomer, seedManager, seedTicket } from '../api/route-runtime';

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

// pull the `to` recipients across every edgeport send call into one flat list
function sentRecipients(sendMock: ReturnType<typeof vi.fn>): string[] {
	return sendMock.mock.calls.flatMap((call) => {
		const to = call[0]?.to;
		return Array.isArray(to) ? to : [to];
	});
}

describe('cloudflare:email agent bridge', () => {
	it('forwards a customer message to the assignee mailbox', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		sendMock.mockClear();

		const manager = await seedManager(runtime);
		await utils.linkAgentEmail(runtime.env, 'manager@example.com', manager.id);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'cust@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Assigned ticket',
			description: 'first',
			customer_id: customer.id,
			assignee_ids: [manager.id]
		});
		await utils.initEmailThread(ticket.id, 'Assigned ticket', 'cust@example.com');

		const handler = await loadEmailHandler();
		await handler({
			message: buildMessage({
				from: 'cust@example.com',
				to: `support+t${ticket.id}@smoke.example.com`,
				subject: 'Re: Assigned ticket',
				body: 'still stuck'
			}),
			env: runtime.env,
			context: {}
		});

		// customer message threaded in, and forwarded to the assignee's mailbox
		const thread = await utils.getTicketThread(ticket.id, runtime.env);
		expect(thread.messages.at(-1)?.sender.kind).toBe('customer');
		expect(sendMock).toHaveBeenCalled();
		expect(sentRecipients(sendMock)).toContain('manager@example.com');
	});

	it('records an agent email reply as a user message and mirrors it to the customer', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		sendMock.mockClear();

		const manager = await seedManager(runtime);
		// agent replies from a work mailbox distinct from their login email
		await utils.linkAgentEmail(runtime.env, 'agent.work@mailbox.test', manager.id);
		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'cust@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Agent replies',
			description: 'first',
			customer_id: customer.id
		});
		await utils.initEmailThread(ticket.id, 'Agent replies', 'cust@example.com');

		const handler = await loadEmailHandler();
		await handler({
			message: buildMessage({
				from: 'agent.work@mailbox.test',
				to: `support+t${ticket.id}@smoke.example.com`,
				subject: 'Re: Agent replies',
				body: 'here is your fix'
			}),
			env: runtime.env,
			context: {}
		});

		const thread = await utils.getTicketThread(ticket.id, runtime.env);
		const last = thread.messages.at(-1);
		expect(last?.sender.kind).toBe('user');
		expect(last?.message).toBe('here is your fix');

		// the reply is mirrored to the customer over edgeport
		expect(sendMock).toHaveBeenCalled();
		expect(sentRecipients(sendMock)).toContain('cust@example.com');
	});

	it('treats an unmatched internal sender as a customer message', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const sendMock = edgeportSend as unknown as ReturnType<typeof vi.fn>;
		sendMock.mockClear();

		const customer = await seedCustomer(runtime, { name: 'Cust', email: 'cust@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Unmatched sender',
			description: 'first',
			customer_id: customer.id
		});
		await utils.initEmailThread(ticket.id, 'Unmatched sender', 'cust@example.com');

		const handler = await loadEmailHandler();
		await handler({
			message: buildMessage({
				from: 'stranger@internal.test',
				to: `support+t${ticket.id}@smoke.example.com`,
				subject: 'Re: Unmatched sender',
				body: 'who am i'
			}),
			env: runtime.env,
			context: {}
		});

		const thread = await utils.getTicketThread(ticket.id, runtime.env);
		const last = thread.messages.at(-1);
		expect(last?.sender.kind).toBe('customer');
		expect(last?.message).toBe('who am i');
	});
});
