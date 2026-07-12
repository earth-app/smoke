import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission } from '~/shared/types/user';
import { getRuntime, seedCustomer, seedTicket } from '../api/route-runtime';

// emailed tickets default to private; list/read as a privileged viewer to see them in these specs
const PRIV_VIEWER = { id: 'sys', permissions: [Permission.ViewPrivateTickets] } as any;

// edgeport imap/pop3 open real TCP sockets; mock both so the poll path is observable offline.
// the mutable state arrays are hoisted so the (hoisted) vi.mock factories can close over them
const { imapState, pop3State } = vi.hoisted(() => ({
	imapState: { messages: [] as string[] },
	pop3State: { messages: [] as string[] }
}));

vi.mock('edgeport/imap', () => ({
	connect: vi.fn(async () => ({
		select: vi.fn(async () => {}),
		search: vi.fn(async () => imapState.messages.map((_, i) => i + 1)),
		fetch: vi.fn(async () => imapState.messages.map((body) => ({ body }))),
		close: vi.fn(async () => {})
	}))
}));

vi.mock('edgeport/pop3', () => ({
	connect: vi.fn(async () => ({
		stat: vi.fn(async () => ({ count: pop3State.messages.length })),
		retrieve: vi.fn(async (n: number) => pop3State.messages[n - 1]),
		close: vi.fn(async () => {})
	}))
}));

type BuildMessageOptions = {
	from: string;
	to?: string;
	subject?: string;
	messageId?: string;
	inReplyTo?: string;
	references?: string;
	body?: string;
	outbound?: boolean;
};

function buildRaw(options: BuildMessageOptions): string {
	const to = options.to ?? 'support@smoke.example.com';
	const lines = [
		`From: ${options.from}`,
		`To: ${to}`,
		options.subject ? `Subject: ${options.subject}` : undefined,
		options.messageId ? `Message-ID: ${options.messageId}` : undefined,
		options.inReplyTo ? `In-Reply-To: ${options.inReplyTo}` : undefined,
		options.references ? `References: ${options.references}` : undefined,
		options.outbound ? 'X-Smoke-Outbound: 1' : undefined,
		'Content-Type: text/plain; charset=utf-8',
		'',
		options.body ?? 'Email body.'
	].filter((line): line is string => line !== undefined);
	return lines.join('\r\n');
}

async function enablePoll(
	env: any,
	opts: { protocol?: 'imap' | 'pop3'; username?: string; password?: string } = {}
): Promise<void> {
	const utils = await import('#server-utils');
	await utils.setJsonSetting('email', {
		support_email: 'support@smoke.example.com',
		poll: {
			enabled: true,
			protocol: opts.protocol ?? 'imap',
			host: 'mail.example.com',
			port: opts.protocol === 'pop3' ? 995 : 993,
			tls: 'implicit',
			username: opts.username ?? 'poller@example.com'
		}
	});
	if (opts.password) await utils.sealEmailPollPassword(opts.password, env.MASTER_KEY);
}

beforeEach(() => {
	imapState.messages = [];
	pop3State.messages = [];
});

describe('pollInboundMailbox', () => {
	it('returns processed:0 when polling is disabled', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await expect(utils.pollInboundMailbox(runtime.env)).resolves.toEqual({ processed: 0 });
	});

	it('creates a ticket + customer from an unseen imap message', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await enablePoll(runtime.env, { protocol: 'imap', password: 'imap-pass' });

		imapState.messages = [
			buildRaw({
				from: '"Polled User" <polled@example.com>',
				subject: 'Need help',
				messageId: '<p1@example.com>',
				body: 'my account is locked'
			})
		];

		const result = await utils.pollInboundMailbox(runtime.env);
		expect(result.processed).toBe(1);

		const customer = await utils.getCustomerByEmail('polled@example.com', runtime.env);
		expect(customer?.email).toBe('polled@example.com');
		expect(customer?.name).toBe('Polled User');

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(1);
		expect(tickets[0]?.title).toBe('Need help');
		expect(tickets[0]?.description).toBe('my account is locked');
	});

	it('threads an imap reply into an existing ticket via the reply alias', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await enablePoll(runtime.env, { protocol: 'imap', password: 'x' });

		const customer = await seedCustomer(runtime, { name: 'Aliased', email: 'alias@example.com' });
		const ticket = await seedTicket(runtime, {
			title: 'Broken login',
			description: 'cannot log in',
			customer_id: customer.id
		});
		await utils.initEmailThread(ticket.id, 'Broken login', 'alias@example.com');

		imapState.messages = [
			buildRaw({
				from: 'alias@example.com',
				to: `support+t${ticket.id}@smoke.example.com`,
				subject: 'Re: Broken login',
				messageId: '<r-alias@example.com>',
				body: 'here is more detail'
			})
		];

		const result = await utils.pollInboundMailbox(runtime.env);
		expect(result.processed).toBe(1);

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(1);

		const thread = await utils.getTicketThread(ticket.id, runtime.env, PRIV_VIEWER);
		expect(thread.messages.at(-1)?.message).toBe('here is more detail');
		expect(thread.messages.at(-1)?.sender.kind).toBe('customer');
	});

	it('threads an imap reply via In-Reply-To when no alias is present', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await enablePoll(runtime.env, { protocol: 'imap', password: 'x' });

		imapState.messages = [
			buildRaw({
				from: 'header@example.com',
				subject: 'Need help',
				messageId: '<orig-1@example.com>',
				body: 'initial'
			})
		];
		await utils.pollInboundMailbox(runtime.env);

		imapState.messages = [
			buildRaw({
				from: 'header@example.com',
				subject: 'Re: Need help',
				messageId: '<reply-1@example.com>',
				inReplyTo: '<orig-1@example.com>',
				body: 'follow-up over email'
			})
		];
		const result = await utils.pollInboundMailbox(runtime.env);
		expect(result.processed).toBe(1);

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(1);

		const thread = await utils.getTicketThread(tickets[0]!.id, runtime.env, PRIV_VIEWER);
		expect(thread.messages.at(-1)?.message).toBe('follow-up over email');
	});

	it('skips a message whose message-id is already indexed', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await enablePoll(runtime.env, { protocol: 'imap', password: 'x' });

		const raw = buildRaw({
			from: 'dup@example.com',
			subject: 'Only once',
			messageId: '<dup-1@example.com>',
			body: 'process me once'
		});

		imapState.messages = [raw];
		expect((await utils.pollInboundMailbox(runtime.env)).processed).toBe(1);

		imapState.messages = [raw];
		expect((await utils.pollInboundMailbox(runtime.env)).processed).toBe(0);

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(1);
	});

	it('skips our own outbound mail echoed back into the polled mailbox', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await enablePoll(runtime.env, { protocol: 'imap', password: 'x' });

		imapState.messages = [
			buildRaw({
				from: 'support@smoke.example.com',
				subject: 'Re: Your ticket',
				messageId: '<echo-1@example.com>',
				body: 'an agent reply that must not loop back into a ticket',
				outbound: true
			})
		];

		expect((await utils.pollInboundMailbox(runtime.env)).processed).toBe(0);
		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(0);
	});

	it('creates a ticket from a pop3 message (stat -> retrieve)', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await enablePoll(runtime.env, { protocol: 'pop3', password: 'pop-pass' });

		pop3State.messages = [
			buildRaw({
				from: 'pop@example.com',
				subject: 'Pop help',
				messageId: '<pop-1@example.com>',
				body: 'received over pop3'
			})
		];

		const result = await utils.pollInboundMailbox(runtime.env);
		expect(result.processed).toBe(1);

		const tickets = await utils.listTickets(runtime.env, '', 1, 10, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets).toHaveLength(1);
		expect(tickets[0]?.title).toBe('Pop help');
	});
});

describe('getInboundPollConfig', () => {
	it('returns null when polling is disabled', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await expect(utils.getInboundPollConfig(runtime.env)).resolves.toBeNull();
	});

	it('resolves the username from settings and the password from sealed kv', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await enablePoll(runtime.env, {
			protocol: 'imap',
			username: 'box@example.com',
			password: 'sealed-pass'
		});

		const config = await utils.getInboundPollConfig(runtime.env);
		expect(config?.protocol).toBe('imap');
		expect(config?.connectOptions.hostname).toBe('mail.example.com');
		expect(config?.connectOptions.tls).toBe('implicit');
		expect(config?.connectOptions.auth.username).toBe('box@example.com');
		expect(config?.connectOptions.auth.password).toBe('sealed-pass');
		expect(config?.support).toBe('support@smoke.example.com');
	});

	it('falls back to POLL_USER / POLL_PASS from env when settings + kv have none', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		await utils.setJsonSetting('email', {
			support_email: 'support@smoke.example.com',
			poll: {
				enabled: true,
				protocol: 'imap',
				host: 'mail.example.com',
				port: 993,
				tls: 'implicit'
			}
		});

		const env = { ...runtime.env, POLL_USER: 'env-user', POLL_PASS: 'env-pass' };
		const config = await utils.getInboundPollConfig(env);
		expect(config?.connectOptions.auth.username).toBe('env-user');
		expect(config?.connectOptions.auth.password).toBe('env-pass');
	});
});
