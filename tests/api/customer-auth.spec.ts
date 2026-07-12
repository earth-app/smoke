import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockCookie,
	seedCustomer,
	seedTicket,
	type RouteRuntime
} from './route-runtime';

const CUSTOMER_SESSION_COOKIE = 'customer_session';

// stub the standalone email send so requestCustomerOtp never touches a real transport;
// the code we assert on is read straight from the kv record it writes
beforeEach(() => {
	(globalThis as any).sendCustomerEmail = vi.fn(async () => true);
});

async function readOtpCode(rt: RouteRuntime, email: string): Promise<string | null> {
	const utils = await import('#server-utils');
	const hash = await utils.hmacSha256(rt.env.HMAC_SECRET, email.trim().toLowerCase());
	const record = (await rt.hubKv.get(`smoke:customer_otp:${hash}`, 'json')) as {
		code: string;
	} | null;
	return record?.code ?? null;
}

// run the full otp flow for a seeded customer and return the minted session token
async function signIn(rt: RouteRuntime, email: string): Promise<string> {
	const requestHandler = await importRoute('~/server/api/portal/request-otp.post');
	mockBody({ email });
	await requestHandler(eventFor(rt.env));

	const code = await readOtpCode(rt, email);
	expect(code).toBeTruthy();

	const verifyHandler = await importRoute('~/server/api/portal/verify-otp.post');
	mockBody({ email, code });
	(globalThis as any).setCookie.mockClear();
	await verifyHandler(eventFor(rt.env));

	const calls = (globalThis as any).setCookie.mock.calls as any[][];
	const call = calls.find((c) => c[1] === CUSTOMER_SESSION_COOKIE && c[2]);
	expect(call).toBeTruthy();
	return call![2] as string;
}

describe('customer OTP auth', () => {
	it('mints a session on verify and resolves the customer from the cookie', async () => {
		const rt = getRuntime();
		const seeded = await seedCustomer(rt, { name: 'Alice', email: 'alice@example.com' });

		const token = await signIn(rt, 'alice@example.com');
		expect(typeof token).toBe('string');
		expect(token.length).toBeGreaterThan(0);

		// getOptionalCustomer (via /api/portal/me) resolves the signed-in customer from the cookie
		mockCookie(token);
		const meHandler = await importRoute('~/server/api/portal/me.get');
		const me = (await meHandler(eventFor(rt.env))) as { customer: { id: number; email: string } };
		expect(me.customer.id).toBe(seeded.id);
		expect(me.customer.email).toBe('alice@example.com');
	});

	it('returns a null customer with no session cookie', async () => {
		const rt = getRuntime();
		mockCookie(null);
		const meHandler = await importRoute('~/server/api/portal/me.get');
		const me = (await meHandler(eventFor(rt.env))) as { customer: unknown };
		expect(me.customer).toBeNull();
	});

	it('rejects a wrong code with 400 and never mints a session', async () => {
		const rt = getRuntime();
		await seedCustomer(rt, { name: 'Bob', email: 'bob@example.com' });

		const requestHandler = await importRoute('~/server/api/portal/request-otp.post');
		mockBody({ email: 'bob@example.com' });
		await requestHandler(eventFor(rt.env));

		const verifyHandler = await importRoute('~/server/api/portal/verify-otp.post');
		mockBody({ email: 'bob@example.com', code: '000000' });
		(globalThis as any).setCookie.mockClear();
		await expect(verifyHandler(eventFor(rt.env))).rejects.toMatchObject({ statusCode: 400 });
		expect((globalThis as any).setCookie.mock.calls.length).toBe(0);
	});

	it('silently succeeds for an unknown email and stores no code', async () => {
		const rt = getRuntime();
		const requestHandler = await importRoute('~/server/api/portal/request-otp.post');
		mockBody({ email: 'nobody@example.com' });
		const result = (await requestHandler(eventFor(rt.env))) as { success: boolean };
		expect(result.success).toBe(true);
		expect(await readOtpCode(rt, 'nobody@example.com')).toBeNull();
	});
});

describe('customer session authorizes public reply', () => {
	it('lets a signed-in customer reply to their own ticket without a token', async () => {
		const rt = getRuntime();
		const customer = await seedCustomer(rt, { name: 'Alice', email: 'alice@example.com' });
		const ticket = await seedTicket(rt, {
			title: 'Cannot log in',
			description: 'password reset broken',
			customer_id: customer.id
		});

		const token = await signIn(rt, 'alice@example.com');
		mockCookie(token);

		const replyHandler = await importRoute('~/server/api/public/reply.post');
		mockBody({ id: ticket.id, message: 'here is more info' });
		const result = (await replyHandler(eventFor(rt.env))) as {
			sender_kind: string;
			message: string;
		};
		expect(result.sender_kind).toBe('customer');
		expect(result.message).toBe('here is more info');

		const utils = await import('#server-utils');
		const thread = await utils.getTicketThread(ticket.id, rt.env, null, { bypassGate: true });
		const last = thread.messages[thread.messages.length - 1];
		expect(last?.message).toBe('here is more info');
		expect(last?.sender.kind).toBe('customer');
	});

	it("refuses to let a session reply to another customer's ticket without a token", async () => {
		const rt = getRuntime();
		const alice = await seedCustomer(rt, { name: 'Alice', email: 'alice@example.com' });
		await seedCustomer(rt, { name: 'Bob', email: 'bob@example.com' });
		const aliceTicket = await seedTicket(rt, {
			title: 'Alice only',
			description: 'hers',
			customer_id: alice.id
		});

		const bobToken = await signIn(rt, 'bob@example.com');
		mockCookie(bobToken);

		const replyHandler = await importRoute('~/server/api/public/reply.post');
		mockBody({ id: aliceTicket.id, message: 'let me in' });
		await expect(replyHandler(eventFor(rt.env))).rejects.toMatchObject({ statusCode: 403 });
	});
});

describe('GET /api/portal/tickets', () => {
	it('returns only the signed-in customer tickets with status tokens', async () => {
		const rt = getRuntime();
		const alice = await seedCustomer(rt, { name: 'Alice', email: 'alice@example.com' });
		const bob = await seedCustomer(rt, { name: 'Bob', email: 'bob@example.com' });

		const t1 = await seedTicket(rt, { title: 'A1', description: 'x', customer_id: alice.id });
		const t2 = await seedTicket(rt, { title: 'A2', description: 'y', customer_id: alice.id });
		await seedTicket(rt, { title: 'B1', description: 'z', customer_id: bob.id });

		const token = await signIn(rt, 'alice@example.com');
		mockCookie(token);

		const ticketsHandler = await importRoute('~/server/api/portal/tickets.get');
		const result = (await ticketsHandler(eventFor(rt.env))) as {
			tickets: { id: number; token: string }[];
		};

		const ids = result.tickets.map((t) => t.id).sort((a, b) => a - b);
		expect(ids).toEqual([t1.id, t2.id].sort((a, b) => a - b));

		const utils = await import('#server-utils');
		for (const summary of result.tickets) {
			const expected = await utils.hmacSha256(rt.env.HMAC_SECRET, `status:${summary.id}`);
			expect(summary.token).toBe(expected);
		}
	});

	it('rejects with 401 when there is no customer session', async () => {
		const rt = getRuntime();
		mockCookie(null);
		const ticketsHandler = await importRoute('~/server/api/portal/tickets.get');
		await expect(ticketsHandler(eventFor(rt.env))).rejects.toMatchObject({ statusCode: 401 });
	});
});
