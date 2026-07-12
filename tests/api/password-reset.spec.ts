import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	seedUser,
	type RouteRuntime
} from './route-runtime';

const OLD_PASSWORD = 'Old!Passw0rd12';
const NEW_PASSWORD = 'New!Passw0rd99';

// stub the standalone email send so requestAgentPasswordReset never touches a real transport;
// the code we assert on is read straight from the kv record it writes
beforeEach(() => {
	(globalThis as any).sendCustomerEmail = vi.fn(async () => true);
});

async function readResetCode(rt: RouteRuntime, email: string): Promise<string | null> {
	const utils = await import('#server-utils');
	const hash = await utils.hmacSha256(rt.env.HMAC_SECRET, email.trim().toLowerCase());
	const record = (await rt.hubKv.get(`smoke:agent_pwreset:${hash}`, 'json')) as {
		code: string;
	} | null;
	return record?.code ?? null;
}

async function requestReset(rt: RouteRuntime, email: string) {
	const handler = await importRoute('~/server/api/agents/forgot-password.post');
	mockBody({ email });
	return (await handler(eventFor(rt.env))) as { success: boolean };
}

async function resetPassword(rt: RouteRuntime, body: Record<string, unknown>) {
	const handler = await importRoute('~/server/api/agents/reset-password.post');
	mockBody(body);
	return await handler(eventFor(rt.env));
}

async function seedAgentWithPassword(rt: RouteRuntime, email = 'reset@example.com') {
	return await seedUser(rt, { username: 'reset_me', email, password: OLD_PASSWORD });
}

describe('POST /api/agents/forgot-password', () => {
	it('returns success and stores a code for a known email', async () => {
		const rt = getRuntime();
		await seedAgentWithPassword(rt);

		const result = await requestReset(rt, 'reset@example.com');
		expect(result.success).toBe(true);
		expect(await readResetCode(rt, 'reset@example.com')).toMatch(/^\d{8}$/);
	});

	it('returns success but stores no code for an unknown email', async () => {
		const rt = getRuntime();
		const result = await requestReset(rt, 'nobody@example.com');
		expect(result.success).toBe(true);
		expect(await readResetCode(rt, 'nobody@example.com')).toBeNull();
	});
});

describe('POST /api/agents/reset-password', () => {
	it('sets the new password on a valid code and invalidates the old one', async () => {
		const rt = getRuntime();
		const seeded = await seedAgentWithPassword(rt);

		await requestReset(rt, 'reset@example.com');
		const code = await readResetCode(rt, 'reset@example.com');
		expect(code).toBeTruthy();

		const result = (await resetPassword(rt, {
			email: 'reset@example.com',
			code,
			password: NEW_PASSWORD
		})) as { success: boolean };
		expect(result.success).toBe(true);

		const utils = await import('#server-utils');
		const login = await utils.logIn('reset@example.com', NEW_PASSWORD, eventFor(rt.env));
		expect(login.user.id).toBe(seeded.id);

		// the old password no longer works
		await expect(
			utils.logIn('reset@example.com', OLD_PASSWORD, eventFor(rt.env))
		).rejects.toMatchObject({ statusCode: 401 });

		// the code is single-use; it's cleared after a successful reset
		expect(await readResetCode(rt, 'reset@example.com')).toBeNull();
	});

	it('rejects a wrong code and leaves the password unchanged', async () => {
		const rt = getRuntime();
		await seedAgentWithPassword(rt);
		await requestReset(rt, 'reset@example.com');

		await expect(
			resetPassword(rt, { email: 'reset@example.com', code: '00000000', password: NEW_PASSWORD })
		).rejects.toMatchObject({ statusCode: 400 });

		const utils = await import('#server-utils');
		const login = await utils.logIn('reset@example.com', OLD_PASSWORD, eventFor(rt.env));
		expect(login.user.username).toBe('reset_me');
	});

	it('rejects an expired code', async () => {
		const rt = getRuntime();
		await seedAgentWithPassword(rt);
		await requestReset(rt, 'reset@example.com');

		const utils = await import('#server-utils');
		const hash = await utils.hmacSha256(rt.env.HMAC_SECRET, 'reset@example.com');
		const key = `smoke:agent_pwreset:${hash}`;
		const record = (await rt.hubKv.get(key, 'json')) as { code: string; expires: number };
		const code = record.code;
		record.expires = Date.now() - 1000;
		await rt.hubKv.set(key, JSON.stringify(record));

		await expect(
			resetPassword(rt, { email: 'reset@example.com', code, password: NEW_PASSWORD })
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it('rejects a code for an email that never requested a reset', async () => {
		const rt = getRuntime();
		await seedAgentWithPassword(rt);

		await expect(
			resetPassword(rt, { email: 'reset@example.com', code: '12345678', password: NEW_PASSWORD })
		).rejects.toMatchObject({ statusCode: 400 });
	});
});
