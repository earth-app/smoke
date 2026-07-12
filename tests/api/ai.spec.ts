import { afterEach, describe, expect, it, vi } from 'vitest';
import { Role } from '~/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedCustomer,
	seedManager,
	seedTicket,
	seedUser
} from './route-runtime';

const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function aiResponse(text: string): Response {
	return new Response(JSON.stringify({ result: { response: text }, success: true }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

// enable ai in kv and link a cloudflare account so isAiEnabled resolves true
async function enableAi(accountId = 'acct-1', extra: Record<string, unknown> = {}): Promise<void> {
	const utils = await import('#server-utils');
	await utils.setJsonSetting('cloudflare', { account_id: accountId });
	await utils.setJsonSetting('ai', { enabled: true, model: AI_MODEL, ...extra });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('isAiEnabled', () => {
	it('is disabled by default', async () => {
		const utils = await import('#server-utils');
		expect(await utils.isAiEnabled(getRuntime().env)).toBe(false);
	});

	it('stays disabled without a linked cloudflare account', async () => {
		const utils = await import('#server-utils');
		await utils.setJsonSetting('ai', { enabled: true, model: AI_MODEL });
		expect(await utils.isAiEnabled(getRuntime().env)).toBe(false);
	});

	it('stays disabled without an api token', async () => {
		const utils = await import('#server-utils');
		await enableAi();
		const env = { ...getRuntime().env, CF_API_TOKEN: '', CF_EMAIL_TOKEN: '' };
		expect(await utils.isAiEnabled(env)).toBe(false);
	});

	it('is enabled once ai is on and an account + token resolve', async () => {
		const utils = await import('#server-utils');
		await enableAi();
		expect(await utils.isAiEnabled(getRuntime().env)).toBe(true);
	});
});

// seal a linked cloudflare token into kv the same way the link/status routes do
async function linkCf(token = 'cf-linked-token', accountId = 'acct-1'): Promise<void> {
	const utils = await import('#server-utils');
	await utils.setJsonSetting('cloudflare', { account_id: accountId });
	const sealed = await utils.sealSecret(token, getRuntime().env.MASTER_KEY);
	await getRuntime().hubKv.set('smoke:setting:cloudflare_token', JSON.stringify(sealed));
}

function verifyResponse(scopes: string[]): Response {
	return new Response(JSON.stringify({ result: { scopes }, success: true }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

describe('aiCapability', () => {
	it('is capable under a mock cloudflare account', async () => {
		const utils = await import('#server-utils');
		const env = { ...getRuntime().env, MOCK_CF: '1' };
		expect(await utils.aiCapability(env)).toEqual({ capable: true });
	});

	it('is not capable without a linked cloudflare account', async () => {
		const utils = await import('#server-utils');
		const result = await utils.aiCapability(getRuntime().env);
		expect(result.capable).toBe(false);
		expect(result.reason).toBe('Link a Cloudflare account first');
	});

	it('is capable when the linked token has the workers ai scope', async () => {
		const utils = await import('#server-utils');
		await linkCf();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => verifyResponse(['Workers AI Read']))
		);
		expect(await utils.aiCapability(getRuntime().env)).toEqual({ capable: true });
	});

	it('is not capable when the linked token lacks the workers ai scope', async () => {
		const utils = await import('#server-utils');
		await linkCf();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => verifyResponse(['DNS Edit']))
		);
		const result = await utils.aiCapability(getRuntime().env);
		expect(result.capable).toBe(false);
		expect(result.reason).toBe('Your Cloudflare API token is missing the Workers AI permission');
	});
});

describe('generateAiReply', () => {
	it('builds a chat request and returns the model text', async () => {
		const utils = await import('#server-utils');
		await enableAi('acct-1', { temperature: 0.4, max_tokens: 300 });

		const fetchMock = vi.fn(async () => aiResponse('Hello from AI'));
		vi.stubGlobal('fetch', fetchMock);

		const result = await utils.generateAiReply(
			{
				ticket: { title: 'Login issue', description: 'cannot log in' } as any,
				history: [
					{ role: 'customer', content: 'still broken' },
					{ role: 'agent', content: 'we are checking' }
				],
				extraContext: 'VIP customer'
			},
			getRuntime().env
		);

		expect(result).toEqual({ text: 'Hello from AI', model: AI_MODEL });
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/acct-1/ai/run/${AI_MODEL}`);
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer cf-api-token');

		const payload = JSON.parse(init.body as string);
		expect(payload.temperature).toBe(0.4);
		expect(payload.max_tokens).toBe(300);
		expect(payload.messages[0].role).toBe('system');
		expect(payload.messages[0].content).toContain('VIP customer');
		expect(payload.messages[0].content).toContain('Login issue');

		const roles = payload.messages.map((m: { role: string }) => m.role);
		expect(roles).toEqual(['system', 'user', 'user', 'assistant']);
		const userContents = payload.messages
			.filter((m: { role: string }) => m.role === 'user')
			.map((m: { content: string }) => m.content);
		expect(userContents).toContain('cannot log in');
		expect(userContents).toContain('still broken');
	});

	it('returns null when ai is disabled and never calls the network', async () => {
		const utils = await import('#server-utils');
		const fetchMock = vi.fn(async () => aiResponse('nope'));
		vi.stubGlobal('fetch', fetchMock);

		const result = await utils.generateAiReply(
			{ ticket: { title: 'x', description: 'y' } as any },
			getRuntime().env
		);
		expect(result).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns null on an api failure without throwing', async () => {
		const utils = await import('#server-utils');
		await enableAi();
		const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
		vi.stubGlobal('fetch', fetchMock);

		const result = await utils.generateAiReply(
			{ ticket: { title: 'x', description: 'y' } as any },
			getRuntime().env
		);
		expect(result).toBeNull();
	});

	it('returns a deterministic canned reply when cloudflare is mocked', async () => {
		const utils = await import('#server-utils');
		await enableAi();
		const fetchMock = vi.fn(async () => aiResponse('should not be used'));
		vi.stubGlobal('fetch', fetchMock);

		const env = { ...getRuntime().env, MOCK_CF: '1' };
		const result = await utils.generateAiReply(
			{ ticket: { title: 'Billing question', description: 'help' } as any },
			env
		);
		expect(result?.model).toBe(AI_MODEL);
		expect(result?.text).toContain('Billing question');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('POST /api/tickets/[id]/ai-draft', () => {
	async function seedTicketFor() {
		const rt = getRuntime();
		const customer = await seedCustomer(rt, { name: 'Ann', email: 'ann@example.com' });
		const ticket = await seedTicket(rt, {
			title: 'Login broken',
			description: 'cannot sign in',
			customer_id: customer.id
		});
		return { rt, ticket };
	}

	it('returns a draft when ai is enabled', async () => {
		const { rt, ticket } = await seedTicketFor();
		const manager = await seedManager(rt);
		await enableAi();

		const fetchMock = vi.fn(async () => aiResponse('Here is a suggested reply.'));
		vi.stubGlobal('fetch', fetchMock);

		const handler = await importRoute('~/server/api/tickets/[id]/ai-draft.post');
		mockParams({ id: ticket.id });
		mockBody({});
		const result = (await handler(eventFor(rt.env, manager.sessionToken))) as {
			text: string;
			model: string;
		};
		expect(result.text).toBe('Here is a suggested reply.');
		expect(result.model).toBe(AI_MODEL);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('rejects with 400 when ai is disabled', async () => {
		const { rt, ticket } = await seedTicketFor();
		const manager = await seedManager(rt);

		const handler = await importRoute('~/server/api/tickets/[id]/ai-draft.post');
		mockParams({ id: ticket.id });
		mockBody({});
		await expect(handler(eventFor(rt.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 400
		});
	});

	it('rejects with 403 without the ReplyTicket permission', async () => {
		const { rt, ticket } = await seedTicketFor();
		const user = await seedUser(rt, {
			username: 'noperms',
			email: 'noperms@example.com',
			role: Role.Agent,
			permissions: []
		});
		await enableAi();

		const handler = await importRoute('~/server/api/tickets/[id]/ai-draft.post');
		mockParams({ id: ticket.id });
		mockBody({});
		await expect(handler(eventFor(rt.env, user.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('rejects with 404 for a missing ticket', async () => {
		const rt = getRuntime();
		const manager = await seedManager(rt);
		await enableAi();

		const handler = await importRoute('~/server/api/tickets/[id]/ai-draft.post');
		mockParams({ id: 9999 });
		mockBody({});
		await expect(handler(eventFor(rt.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
