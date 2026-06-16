import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockHeader,
	mockMultipart,
	mockParams,
	seedAgent,
	seedManager
} from '../../route-runtime';

const ROUTE = '../../../../src/server/api/users/[id]/avatar.post';

describe('POST /api/users/:id/avatar', () => {
	it('rejects an unauthenticated request with 401', async () => {
		const runtime = getRuntime();
		const user = await seedManager(runtime);
		const handler = await importRoute(ROUTE);

		mockParams({ id: user.id });
		mockBody({ url: 'https://cdn.example.com/a.png' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 401 });
	});

	it('sets an external https url avatar', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute(ROUTE);

		mockParams({ id: manager.id });
		mockBody({ url: 'https://cdn.example.com/a.png' });
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			avatar_url?: string;
		};

		expect(result.avatar_url).toBe('https://cdn.example.com/a.png');
		expect(runtime.blob.has(`avatar/${manager.id}`)).toBe(false);
	});

	it('uploads a base64 image and marks the avatar as local', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute(ROUTE);

		mockParams({ id: manager.id });
		mockBody({ base64: 'data:image/png;base64,aGVsbG8=' });
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			avatar_url?: string;
		};

		expect(result.avatar_url).toBe('local');
		expect(runtime.blob.has(`avatar/${manager.id}`)).toBe(true);
	});

	it('uploads a multipart file and marks the avatar as local', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute(ROUTE);

		mockParams({ id: manager.id });
		mockHeader('multipart/form-data; boundary=----test');
		mockMultipart([
			{ name: 'avatar', filename: 'a.png', type: 'image/png', data: Buffer.from('img') }
		]);
		const result = (await handler(eventFor(runtime.env, manager.sessionToken))) as {
			avatar_url?: string;
		};

		expect(result.avatar_url).toBe('local');
		expect(runtime.blob.has(`avatar/${manager.id}`)).toBe(true);
	});

	it('rejects a multipart upload missing the avatar file with 400', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute(ROUTE);

		mockParams({ id: manager.id });
		mockHeader('multipart/form-data; boundary=----test');
		mockMultipart([
			{ name: 'notavatar', filename: 'x.png', type: 'image/png', data: Buffer.from('x') }
		]);
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 400
		});
	});

	it('rejects when no avatar data is provided with 400', async () => {
		const runtime = getRuntime();
		const manager = await seedManager(runtime);
		const handler = await importRoute(ROUTE);

		mockParams({ id: manager.id });
		mockBody({});
		await expect(handler(eventFor(runtime.env, manager.sessionToken))).rejects.toMatchObject({
			statusCode: 400
		});
	});

	it('rejects a caller without write access with 403', async () => {
		const runtime = getRuntime();
		const caller = await seedAgent(runtime, 'caller_agent', 'caller@example.com');
		const target = await seedManager(runtime, 'target_manager', 'target@example.com');
		const handler = await importRoute(ROUTE);

		mockParams({ id: target.id });
		mockBody({ url: 'https://cdn.example.com/a.png' });
		await expect(handler(eventFor(runtime.env, caller.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});
