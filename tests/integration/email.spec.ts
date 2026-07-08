import { connect } from 'edgeport/imap';
import { describe, expect, it } from 'vitest';
// importing the harness registers its beforeEach(setupApiRuntime)/afterEach(teardownApiRuntime)
// so every test gets a fresh in-memory db + kv + collegedb init
import { getRuntime } from '../api/route-runtime';

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
