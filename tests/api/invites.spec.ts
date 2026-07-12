import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '~/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedAgent,
	seedManager,
	type RouteRuntime
} from './route-runtime';

const PASSWORD = 'Str0ng!Passw0rd';

// stub the standalone email send so an invite with an address never touches a real transport
beforeEach(() => {
	(globalThis as any).sendCustomerEmail = vi.fn(async () => true);
});

type InviteResult = {
	success: boolean;
	token: string;
	url: string;
	email: string | null;
	expires: number;
	max_uses: number;
	emailed: boolean;
};

async function createInvite(
	rt: RouteRuntime,
	sessionToken: string,
	body: Record<string, unknown> = {}
): Promise<InviteResult> {
	const handler = await importRoute('~/server/api/agents/invite.post');
	mockBody(body);
	return (await handler(eventFor(rt.env, sessionToken))) as InviteResult;
}

async function inviteState(token: string) {
	const handler = await importRoute('~/server/api/agents/invite/[token].get');
	mockParams({ token });
	return (await handler(eventFor(getRuntime().env))) as {
		status: string;
		email: string | null;
		remaining_uses: number;
	};
}

async function join(rt: RouteRuntime, body: Record<string, unknown>) {
	const handler = await importRoute('~/server/api/agents/join.post');
	mockBody(body);
	return (await handler(eventFor(rt.env))) as {
		success: boolean;
		user_id: string;
		session_token: string;
	};
}

async function readInvite(rt: RouteRuntime, token: string): Promise<any> {
	return await rt.hubKv.get(`smoke:agent_invite:${token}`, 'json');
}

describe('POST /api/agents/invite (create)', () => {
	it('creates an invite for a caller with ManageUsers', async () => {
		const rt = getRuntime();
		const manager = await seedManager(rt);

		const result = await createInvite(rt, manager.sessionToken);
		expect(result.success).toBe(true);
		expect(result.token.length).toBeGreaterThan(0);
		expect(result.url).toBe(`https://smoke.example.com/join/${result.token}`);
		expect(result.max_uses).toBe(1);

		const record = await readInvite(rt, result.token);
		expect(record).toMatchObject({ role: 'agent', createdBy: manager.id, uses: 0, maxUses: 1 });
	});

	it('rejects a caller without ManageUsers', async () => {
		const rt = getRuntime();
		const agent = await seedAgent(rt);
		const handler = await importRoute('~/server/api/agents/invite.post');
		mockBody({});
		await expect(handler(eventFor(rt.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('rejects an unauthenticated request', async () => {
		const rt = getRuntime();
		const handler = await importRoute('~/server/api/agents/invite.post');
		mockBody({});
		await expect(handler(eventFor(rt.env))).rejects.toMatchObject({ statusCode: 401 });
	});

	it('emails the invite link when an address is given', async () => {
		const rt = getRuntime();
		const manager = await seedManager(rt);

		const result = await createInvite(rt, manager.sessionToken, { email: 'new.agent@example.com' });
		expect(result.email).toBe('new.agent@example.com');
		expect(result.emailed).toBe(true);

		const send = (globalThis as any).sendCustomerEmail as ReturnType<typeof vi.fn>;
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0]![0]).toBe('new.agent@example.com');
	});
});

describe('GET /api/agents/invite/[token]', () => {
	it('reports a valid invite without consuming a use', async () => {
		const rt = getRuntime();
		const manager = await seedManager(rt);
		const { token } = await createInvite(rt, manager.sessionToken, { email: 'bound@example.com' });

		const state = await inviteState(token);
		expect(state.status).toBe('valid');
		expect(state.email).toBe('bound@example.com');
		expect(state.remaining_uses).toBe(1);

		// still unconsumed
		const record = await readInvite(rt, token);
		expect(record.uses).toBe(0);
	});

	it('returns not_found for an unknown token', async () => {
		await seedManager(getRuntime());
		const state = await inviteState('does-not-exist');
		expect(state.status).toBe('not_found');
		expect(state.email).toBeNull();
	});
});

describe('POST /api/agents/join', () => {
	it('redeems a bound-email invite, creates the agent, and consumes the single use', async () => {
		const rt = getRuntime();
		const manager = await seedManager(rt);
		const { token } = await createInvite(rt, manager.sessionToken, {
			email: 'joiner@example.com'
		});

		const result = await join(rt, {
			token,
			username: 'joiner',
			password: PASSWORD,
			firstName: 'Joan'
		});
		expect(result.success).toBe(true);
		expect(result.session_token.length).toBeGreaterThan(0);

		const utils = await import('#server-utils');
		const created = await utils.getUserByUsername('joiner', rt.env);
		expect(created).toMatchObject({
			username: 'joiner',
			email: 'joiner@example.com',
			role: Role.Agent,
			first_name: 'Joan'
		});

		// the new agent can log in with the password they chose
		const login = await utils.logIn('joiner@example.com', PASSWORD, eventFor(rt.env));
		expect(login.user.id).toBe(created!.id);

		// single-use invite is gone; a second join with the same token fails
		expect(await readInvite(rt, token)).toBeNull();
		await expect(
			join(rt, { token, username: 'joiner2', password: PASSWORD })
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it('requires an email for an open invite and uses the supplied one', async () => {
		const rt = getRuntime();
		const manager = await seedManager(rt);
		const { token } = await createInvite(rt, manager.sessionToken);

		// no email on an open invite -> 400 (and no use burned)
		await expect(join(rt, { token, username: 'open1', password: PASSWORD })).rejects.toMatchObject({
			statusCode: 400
		});
		expect((await readInvite(rt, token)).uses).toBe(0);

		const result = await join(rt, {
			token,
			username: 'open1',
			password: PASSWORD,
			email: 'open1@example.com'
		});
		expect(result.success).toBe(true);

		const utils = await import('#server-utils');
		const created = await utils.getUserByUsername('open1', rt.env);
		expect(created?.email).toBe('open1@example.com');
	});

	it('rejects a username that is already taken', async () => {
		const rt = getRuntime();
		const manager = await seedManager(rt, 'taken_user', 'taken@example.com');
		const { token } = await createInvite(rt, manager.sessionToken);

		await expect(
			join(rt, { token, username: 'taken_user', password: PASSWORD, email: 'other@example.com' })
		).rejects.toMatchObject({ statusCode: 409 });
	});

	it('rejects an expired invite', async () => {
		const rt = getRuntime();
		const manager = await seedManager(rt);
		const { token } = await createInvite(rt, manager.sessionToken, { email: 'late@example.com' });

		// force the record into the past
		const record = await readInvite(rt, token);
		record.expires = Date.now() - 1000;
		await rt.hubKv.set(`smoke:agent_invite:${token}`, JSON.stringify(record));

		expect((await inviteState(token)).status).toBe('expired');
		await expect(join(rt, { token, username: 'late', password: PASSWORD })).rejects.toMatchObject({
			statusCode: 400
		});
	});

	it('honors maxUses across multiple joins', async () => {
		const rt = getRuntime();
		const manager = await seedManager(rt);
		const { token } = await createInvite(rt, manager.sessionToken, { maxUses: 2 });

		await join(rt, { token, username: 'multi1', password: PASSWORD, email: 'multi1@example.com' });
		expect((await inviteState(token)).remaining_uses).toBe(1);

		// second use exhausts + deletes the invite (per the consume contract)
		await join(rt, { token, username: 'multi2', password: PASSWORD, email: 'multi2@example.com' });
		expect(await readInvite(rt, token)).toBeNull();
		expect((await inviteState(token)).status).toBe('not_found');

		await expect(
			join(rt, { token, username: 'multi3', password: PASSWORD, email: 'multi3@example.com' })
		).rejects.toMatchObject({ statusCode: 400 });
	});

	it('rejects an exhausted invite that is still present', async () => {
		const rt = getRuntime();
		const manager = await seedManager(rt);
		const { token } = await createInvite(rt, manager.sessionToken, { email: 'done@example.com' });

		// mark it fully used without deleting, to exercise the exhausted branch
		const record = await readInvite(rt, token);
		record.uses = record.maxUses;
		await rt.hubKv.set(`smoke:agent_invite:${token}`, JSON.stringify(record));

		expect((await inviteState(token)).status).toBe('exhausted');
		await expect(join(rt, { token, username: 'done', password: PASSWORD })).rejects.toMatchObject({
			statusCode: 400
		});
	});
});
