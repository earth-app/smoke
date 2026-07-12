import { connect } from 'edgeport/imap';
import { send } from 'edgeport/smtp';
import { beforeEach, describe, expect, it } from 'vitest';
import { Permission } from '~/shared/types/user';
// importing the harness registers its beforeEach(setupApiRuntime)/afterEach(teardownApiRuntime)
// so every test gets a fresh in-memory db + kv + collegedb init
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedManager
} from '../api/route-runtime';

// real greenmail round-trip: agent reply out over smtp, then read it back over imap.
// gated by vitest.config (INTEGRATION=1 includes only tests/integration) so the default lane skips it
describe('greenmail email round-trip', () => {
	it('sends a threaded agent reply over smtp and receives it over imap', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');

		// point the outbound transport at greenmail (env override wins in getEmailConfig)
		const env = {
			...runtime.env,
			SMTP_HOST: '127.0.0.1',
			SMTP_PORT: '3025',
			SMTP_TLS: 'off',
			SMTP_USER: 'tester',
			SMTP_PASS: 'testpass',
			SMTP_FROM: 'tester@localhost'
		};

		const email = 'tester@localhost';
		const customer = await utils.createCustomer({ name: 'Tester', email }, env);
		const ticket = await utils.createTicket(
			{ title: 'Round trip', description: 'please reply', customer_id: customer.id },
			env
		);
		await utils.initEmailThread(ticket.id, 'Round trip', email);

		// unique per run without Date.now/Math.random: derive from the ticket id
		const marker = `smoke-marker-t${ticket.id}`;
		const alias = `support+t${ticket.id}@`;

		const sent = await utils.sendTicketEmailReply(ticket.id, `hello from smoke ${marker}`, env);
		expect(sent).toBe(true);

		const session = await connect({
			hostname: '127.0.0.1',
			port: 3143,
			tls: 'off',
			auth: { username: 'tester', password: 'testpass' }
		});
		try {
			await session.select('INBOX');
			const uids = await session.search({ all: true });
			expect(uids.length).toBeGreaterThan(0);

			const messages = await session.fetch(uids, { body: true });
			const bodies = messages.map((m) => (m.body ? new TextDecoder().decode(m.body) : ''));

			expect(bodies.some((b) => b.includes(marker))).toBe(true);
			expect(bodies.some((b) => b.includes(alias))).toBe(true);
		} finally {
			await session.close();
		}
	});
});

// non-email-thread tickets don't get the live smtp mirror, so notifyTicketEvent is what reaches the
// customer. this proves that path delivers a real message end-to-end over greenmail
describe('greenmail notification emails', () => {
	it('delivers a customer notification for a non-thread ticket message', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');

		const env = {
			...runtime.env,
			SMTP_HOST: '127.0.0.1',
			SMTP_PORT: '3025',
			SMTP_TLS: 'off',
			SMTP_USER: 'tester',
			SMTP_PASS: 'testpass',
			SMTP_FROM: 'tester@localhost'
		};

		const email = 'tester@localhost';
		const customer = await utils.createCustomer({ name: 'Tester', email }, env);
		// a plain ui-created ticket (no initEmailThread) so notifyTicketEvent is the delivery path
		const ticket = await utils.createTicket(
			{ title: 'Notify me', description: 'ui ticket, no email thread', customer_id: customer.id },
			env
		);

		// unique per run without Date.now/Math.random: derive from the ticket id
		const marker = `notify-marker-t${ticket.id}`;

		// an agent posted a message; the customer (not the actor) must be emailed
		await utils.notifyTicketEvent('message', ticket, env, {
			actorId: 'some-other-agent',
			message: `please review this ${marker}`
		});

		const session = await connect({
			hostname: '127.0.0.1',
			port: 3143,
			tls: 'off',
			auth: { username: 'tester', password: 'testpass' }
		});
		try {
			await session.select('INBOX');
			const uids = await session.search({ all: true });
			expect(uids.length).toBeGreaterThan(0);

			const messages = await session.fetch(uids, { body: true });
			const bodies = messages.map((m) => (m.body ? new TextDecoder().decode(m.body) : ''));

			// the message snippet lands in the body and the ticket number in the subject line
			expect(bodies.some((b) => b.includes(marker))).toBe(true);
			expect(bodies.some((b) => b.includes(`Ticket #${ticket.id}`))).toBe(true);
		} finally {
			await session.close();
		}
	});
});

// #region inbound poll helpers

const IMAP_PORT = 3143;
const POP3_PORT = 3110;

// emailed tickets default to private, so read them back as a privileged viewer
const PRIV_VIEWER = { id: 'sys', permissions: [Permission.ViewPrivateTickets] } as any;

// greenmail persists its mailbox across tests (docker); each inbound test starts from empty so
// counts + threading are exact and no prior-test mail is re-ingested into the fresh per-test db
async function purgeGreenmail(): Promise<void> {
	await fetch('http://127.0.0.1:8080/api/mail/purge', { method: 'POST' });
}

// deliver a fully controlled rfc822 message; edgeport's convenience api injects its own random
// Message-ID before our headers, so we hand it a pre-rendered raw to keep message-id/threading exact
async function deliver(fields: {
	from: string;
	subject: string;
	body: string;
	to?: string;
	cc?: string;
	messageId?: string;
	inReplyTo?: string;
	references?: string;
}): Promise<void> {
	const headerTo = fields.to ?? 'tester@localhost';
	const lines = [
		`From: ${fields.from}`,
		`To: ${headerTo}`,
		fields.cc ? `Cc: ${fields.cc}` : undefined,
		`Subject: ${fields.subject}`,
		fields.messageId ? `Message-ID: ${fields.messageId}` : undefined,
		fields.inReplyTo ? `In-Reply-To: ${fields.inReplyTo}` : undefined,
		fields.references ? `References: ${fields.references}` : undefined,
		'Content-Type: text/plain; charset=utf-8',
		'',
		fields.body
	].filter((line): line is string => line !== undefined);

	// envelope rcpt is always tester@localhost so the mail lands in the polled mailbox even when the
	// To header carries a reply alias on another domain; subject is required by the type but ignored
	// once raw is set
	await send({
		hostname: '127.0.0.1',
		port: 3025,
		tls: 'off',
		auth: { username: 'tester', password: 'testpass' },
		from: fields.from,
		to: 'tester@localhost',
		subject: fields.subject,
		raw: new TextEncoder().encode(lines.join('\r\n'))
	});
}

async function seedPollSettings(protocol: 'imap' | 'pop3', port: number): Promise<void> {
	const utils = await import('#server-utils');
	await utils.setJsonSetting('email', {
		transport: 'smtp',
		support_email: 'tester@localhost',
		poll: { enabled: true, protocol, host: '127.0.0.1', port, tls: 'off', username: 'tester' }
	});
}

async function readInbox(): Promise<string[]> {
	const session = await connect({
		hostname: '127.0.0.1',
		port: IMAP_PORT,
		tls: 'off',
		auth: { username: 'tester', password: 'testpass' }
	});
	try {
		await session.select('INBOX');
		const uids = await session.search({ all: true });
		if (uids.length === 0) return [];
		const messages = await session.fetch(uids, { body: true });
		return messages.map((m) => (m.body ? new TextDecoder().decode(m.body) : ''));
	} finally {
		await session.close();
	}
}

// #endregion

// real greenmail inbound: deliver over smtp, poll the mailbox via imap/pop3, assert the ticket state.
// the poll path (email-poll.ts) had zero coverage; this is the true mail-server -> ticket lane
describe('greenmail inbound poll (imap/pop3)', () => {
	beforeEach(async () => {
		await purgeGreenmail();
	});

	it('imap: opens a ticket + customer from an inbound customer email', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const env = { ...runtime.env, POLL_USER: 'tester', POLL_PASS: 'testpass' };
		await seedPollSettings('imap', IMAP_PORT);

		const subject = 'Imap Basic Request';
		const marker = 'imap-basic-body-marker';
		await deliver({
			from: 'customer@example.com',
			subject,
			body: `please help ${marker}`,
			messageId: '<imap-basic-1@example.com>'
		});

		const { processed } = await utils.pollInboundMailbox(env);
		expect(processed).toBeGreaterThanOrEqual(1);

		const customer = await utils.getCustomerByEmail('customer@example.com', env);
		expect(customer?.email).toBe('customer@example.com');

		const tickets = await utils.listTickets(env, '', 1, 50, 0, 'id', 'asc', PRIV_VIEWER);
		const ticket = tickets.find((t) => t.title === subject);
		expect(ticket).toBeTruthy();
		expect(ticket!.description).toContain(marker);
		expect(ticket!.customer_id).toBe(customer!.id);
	});

	it('imap: threads a reply into the same ticket via In-Reply-To', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const env = { ...runtime.env, POLL_USER: 'tester', POLL_PASS: 'testpass' };
		await seedPollSettings('imap', IMAP_PORT);

		const subject = 'Imap Header Threading';
		await deliver({
			from: 'header@example.com',
			subject,
			body: 'first message imap-thread-orig',
			messageId: '<inbound-a@example.com>'
		});
		const first = await utils.pollInboundMailbox(env);
		expect(first.processed).toBeGreaterThanOrEqual(1);

		const opened = await utils.listTickets(env, '', 1, 50, 0, 'id', 'asc', PRIV_VIEWER);
		const ticket = opened.find((t) => t.title === subject);
		expect(ticket).toBeTruthy();
		const T = ticket!.id;

		// reply points at the original message-id via In-Reply-To + References, no alias
		await purgeGreenmail();
		const replyMarker = 'imap-thread-reply-marker';
		await deliver({
			from: 'header@example.com',
			subject: `Re: ${subject}`,
			body: `more detail ${replyMarker}`,
			messageId: '<inbound-b@example.com>',
			inReplyTo: '<inbound-a@example.com>',
			references: '<inbound-a@example.com>'
		});
		await utils.pollInboundMailbox(env);

		// no second ticket; the reply threaded into T as a customer message
		const after = await utils.listTickets(env, '', 1, 50, 0, 'id', 'asc', PRIV_VIEWER);
		expect(after).toHaveLength(1);
		const thread = await utils.getTicketThread(T, env, PRIV_VIEWER);
		expect(thread.messages).toHaveLength(1);
		expect(thread.messages[0]?.message).toContain(replyMarker);
		expect(thread.messages[0]?.sender.kind).toBe('customer');
	});

	it('imap: threads a reply into the same ticket via the reply alias', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const env = { ...runtime.env, POLL_USER: 'tester', POLL_PASS: 'testpass' };
		await seedPollSettings('imap', IMAP_PORT);

		const subject = 'Imap Alias Threading';
		await deliver({
			from: 'alias@example.com',
			subject,
			body: 'first alias imap-alias-orig',
			messageId: '<alias-a@example.com>'
		});
		await utils.pollInboundMailbox(env);
		const opened = await utils.listTickets(env, '', 1, 50, 0, 'id', 'asc', PRIV_VIEWER);
		const ticket = opened.find((t) => t.title === subject);
		expect(ticket).toBeTruthy();
		const T = ticket!.id;

		// reply addressed only to support+t<T>@ (no In-Reply-To); the poll resolves the alias from
		// the To header via extractRecipient
		await purgeGreenmail();
		const replyMarker = 'imap-alias-reply-marker';
		await deliver({
			from: 'alias@example.com',
			to: `support+t${T}@example.com`,
			subject: `Re: ${subject}`,
			body: `alias reply ${replyMarker}`,
			messageId: '<alias-b@example.com>'
		});
		await utils.pollInboundMailbox(env);

		const after = await utils.listTickets(env, '', 1, 50, 0, 'id', 'asc', PRIV_VIEWER);
		expect(after).toHaveLength(1);
		const thread = await utils.getTicketThread(T, env, PRIV_VIEWER);
		expect(thread.messages).toHaveLength(1);
		expect(thread.messages[0]?.message).toContain(replyMarker);
		expect(thread.messages[0]?.sender.kind).toBe('customer');
	});

	it('imap: dedups a message-id across polls (body.peek keeps mail unseen)', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const env = { ...runtime.env, POLL_USER: 'tester', POLL_PASS: 'testpass' };
		await seedPollSettings('imap', IMAP_PORT);

		const subject = 'Imap Dedup';
		await deliver({
			from: 'dedup@example.com',
			subject,
			body: 'only once imap-dedup',
			messageId: '<dedup-1@example.com>'
		});

		const firstPoll = await utils.pollInboundMailbox(env);
		expect(firstPoll.processed).toBe(1);

		// edgeport fetches with BODY.PEEK so the message stays unseen and is re-fetched; the message-id
		// index is the only thing preventing a duplicate ticket on the second poll
		const secondPoll = await utils.pollInboundMailbox(env);
		expect(secondPoll.processed).toBe(0);

		const tickets = await utils.listTickets(env, '', 1, 50, 0, 'id', 'asc', PRIV_VIEWER);
		expect(tickets.filter((t) => t.title === subject)).toHaveLength(1);
		expect(tickets).toHaveLength(1);
	});

	it('pop3: opens a ticket + customer from an inbound customer email', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const env = { ...runtime.env, POLL_USER: 'tester', POLL_PASS: 'testpass' };
		await seedPollSettings('pop3', POP3_PORT);

		const subject = 'Pop3 Basic Request';
		const marker = 'pop3-basic-body-marker';
		await deliver({
			from: 'pop-customer@example.com',
			subject,
			body: `need assistance ${marker}`,
			messageId: '<pop3-basic-1@example.com>'
		});

		const { processed } = await utils.pollInboundMailbox(env);
		expect(processed).toBeGreaterThanOrEqual(1);

		const customer = await utils.getCustomerByEmail('pop-customer@example.com', env);
		expect(customer?.email).toBe('pop-customer@example.com');

		const tickets = await utils.listTickets(env, '', 1, 50, 0, 'id', 'asc', PRIV_VIEWER);
		const ticket = tickets.find((t) => t.title === subject);
		expect(ticket).toBeTruthy();
		expect(ticket!.description).toContain(marker);
		expect(ticket!.customer_id).toBe(customer!.id);
	});

	it('hybrid: an inbound email ticket loops through a ui reply and back over email', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const env = { ...runtime.env, POLL_USER: 'tester', POLL_PASS: 'testpass' };
		await seedPollSettings('imap', IMAP_PORT);

		// emailed tickets default to private; the mirror still reaches the originating customer on any
		// email thread, so we exercise the real ui->email loop against the default visibility

		// greenmail exposes a single deliverable mailbox, so the customer IS tester@localhost; in
		// production the polled support inbox and the customer address differ (which is why we purge
		// between the outbound mirror and the customer's reply so the mirror never echoes back in)
		const subject = 'Hybrid Loop';
		await deliver({
			from: 'tester@localhost',
			subject,
			body: 'hybrid opening message',
			messageId: '<hybrid-1@localhost>'
		});
		const opened = await utils.pollInboundMailbox(env);
		expect(opened.processed).toBeGreaterThanOrEqual(1);

		const tickets = await utils.listTickets(env, '', 1, 50, 0, 'id', 'asc', PRIV_VIEWER);
		const ticket = tickets.find((t) => t.title === subject);
		expect(ticket).toBeTruthy();
		const T = ticket!.id;

		// agent answers through the real messages route; the route mirrors it to the customer via smtp
		const admin = await seedManager(runtime);
		const agentMarker = 'hybrid-agent-reply-marker';
		const routeEnv = {
			...runtime.env,
			SMTP_HOST: '127.0.0.1',
			SMTP_PORT: '3025',
			SMTP_TLS: 'off',
			SMTP_USER: 'tester',
			SMTP_PASS: 'testpass',
			SMTP_FROM: 'tester@localhost'
		};
		const handler = await importRoute('~/server/api/tickets/[id]/messages/index.post');
		mockParams({ id: T });
		mockBody({ message: `agent answer ${agentMarker}`, identity: 'self' });
		await handler(eventFor(routeEnv, admin.sessionToken));

		// the mirror reached tester@localhost carrying the agent marker + the ticket's reply alias
		const inbox = await readInbox();
		expect(inbox.some((b) => b.includes(agentMarker))).toBe(true);
		expect(inbox.some((b) => b.includes(`+t${T}@`))).toBe(true);

		// the customer emails back; the poll threads the reply into the same ticket, closing the loop
		await purgeGreenmail();
		const custMarker = 'hybrid-customer-reply-marker';
		await deliver({
			from: 'tester@localhost',
			subject: `Re: ${subject}`,
			body: `customer follow-up ${custMarker}`,
			messageId: '<hybrid-2@localhost>',
			inReplyTo: '<hybrid-1@localhost>',
			references: '<hybrid-1@localhost>'
		});
		await utils.pollInboundMailbox(env);

		const after = await utils.listTickets(env, '', 1, 50, 0, 'id', 'asc', PRIV_VIEWER);
		expect(after).toHaveLength(1);
		const thread = await utils.getTicketThread(T, env, PRIV_VIEWER);
		expect(
			thread.messages.some((m) => m.message.includes(agentMarker) && m.sender.kind === 'user')
		).toBe(true);
		expect(
			thread.messages.some((m) => m.message.includes(custMarker) && m.sender.kind === 'customer')
		).toBe(true);
	});
});

// pull the Cc header value from a raw rfc822 message (single line; participants never fold here)
function ccHeader(raw: string): string {
	const match = raw.match(/^cc:[ \t]*(.*)$/im);
	return (match?.[1] ?? '').trim().toLowerCase();
}

// ticket participants over the real mail server: outbound auto-cc on a reply, and inbound cc capture
// on a polled customer email. proves the participant plumbing survives a true smtp/imap round-trip
describe('greenmail ticket participants', () => {
	beforeEach(async () => {
		await purgeGreenmail();
	});

	it('auto-ccs a ticket participant on an agent reply and keeps the primary customer off cc', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');

		// point the outbound transport at greenmail (env override wins in getEmailConfig)
		const env = {
			...runtime.env,
			SMTP_HOST: '127.0.0.1',
			SMTP_PORT: '3025',
			SMTP_TLS: 'off',
			SMTP_USER: 'tester',
			SMTP_PASS: 'testpass',
			SMTP_FROM: 'tester@localhost'
		};

		const primary = 'tester@localhost';
		const participant = 'colleague@localhost';
		const customer = await utils.createCustomer({ name: 'Tester', email: primary }, env);
		const ticket = await utils.createTicket(
			{ title: 'Cc round trip', description: 'loop the colleague in', customer_id: customer.id },
			env
		);
		await utils.initEmailThread(ticket.id, 'Cc round trip', primary);

		const added = await utils.addTicketParticipant(ticket.id, participant, env);
		expect(added.participants).toContain(participant);

		// unique per run without Date.now/Math.random: derive from the ticket id
		const marker = `cc-marker-t${ticket.id}`;
		const sent = await utils.sendTicketEmailReply(ticket.id, `hello with a cc ${marker}`, env);
		expect(sent).toBe(true);

		const inbox = await readInbox();
		const message = inbox.find((b) => b.includes(marker));
		expect(message).toBeTruthy();

		// the participant is copied on the reply; the primary customer sits on To, never Cc
		const cc = ccHeader(message!);
		expect(cc).toContain(participant);
		expect(cc).not.toContain(primary);
	});

	it('captures an inbound cc address as a ticket participant, skipping the support address', async () => {
		const runtime = getRuntime();
		const utils = await import('#server-utils');
		const env = { ...runtime.env, POLL_USER: 'tester', POLL_PASS: 'testpass' };
		await seedPollSettings('imap', IMAP_PORT);

		const subject = 'Cc Capture Request';
		await deliver({
			from: 'requester@example.com',
			to: 'tester@localhost',
			cc: 'colleague@example.com',
			subject,
			body: 'please help and cc my colleague cc-capture-body',
			messageId: '<cc-capture-1@example.com>'
		});

		const { processed } = await utils.pollInboundMailbox(env);
		expect(processed).toBeGreaterThanOrEqual(1);

		const tickets = await utils.listTickets(env, '', 1, 50, 0, 'id', 'asc', PRIV_VIEWER);
		const ticket = tickets.find((t) => t.title === subject);
		expect(ticket).toBeTruthy();

		const participants = await utils.getTicketParticipants(ticket!.id);
		expect(participants).toContain('colleague@example.com');
		// the support address (the To recipient) and the sender are never captured as participants
		expect(participants).not.toContain('tester@localhost');
		expect(participants).not.toContain('requester@example.com');
	});
});
