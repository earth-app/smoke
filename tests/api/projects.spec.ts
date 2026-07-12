import { beforeAll, describe, expect, it } from 'vitest';
import { Role } from '~/shared/types/user';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	seedAgent,
	seedUser
} from './route-runtime';

// the server-utils barrel doesn't register the projects util on globalThis; the routes
// reference its exports as nitro auto-imports, so wire them up for this suite
beforeAll(async () => {
	const projects = await import('~/server/utils/projects');
	for (const [key, value] of Object.entries(projects)) {
		(globalThis as Record<string, unknown>)[key] = value;
	}
});

async function seedAdmin() {
	return await seedUser(getRuntime(), {
		username: 'admin',
		email: 'admin@example.com',
		role: Role.Admin
	});
}

describe('POST /api/projects', () => {
	it('rejects a caller without ManageSettings', async () => {
		const agent = await seedAgent(getRuntime());
		const handler = await importRoute('~/server/api/projects/index.post');
		mockBody({ name: 'Bugs' });
		await expect(handler(eventFor(getRuntime().env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('creates projects with incrementing ids', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/projects/index.post');

		mockBody({ name: 'Bugs', description: 'Bug tracking', color: '#ff0000' });
		const first = (await post(eventFor(getRuntime().env, admin.sessionToken))) as any;
		expect(first.id).toBe(1);
		expect(first.name).toBe('Bugs');
		expect(first.color).toBe('#ff0000');

		mockBody({ name: 'Features' });
		const second = (await post(eventFor(getRuntime().env, admin.sessionToken))) as any;
		expect(second.id).toBe(2);
	});
});

describe('GET /api/projects', () => {
	it('lists projects for any logged-in staff', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/projects/index.post');
		mockBody({ name: 'Bugs' });
		await post(eventFor(getRuntime().env, admin.sessionToken));

		const agent = await seedAgent(getRuntime());
		const get = await importRoute('~/server/api/projects/index.get');
		const list = (await get(eventFor(getRuntime().env, agent.sessionToken))) as any[];
		expect(list).toHaveLength(1);
		expect(list[0].name).toBe('Bugs');
	});
});

describe('PATCH /api/projects/[id]', () => {
	it('updates a project name and color', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/projects/index.post');
		mockBody({ name: 'Bugs' });
		await post(eventFor(getRuntime().env, admin.sessionToken));

		const patch = await importRoute('~/server/api/projects/[id]/index.patch');
		mockParams({ id: 1 });
		mockBody({ name: 'Defects', color: '#00ff00' });
		const updated = (await patch(eventFor(getRuntime().env, admin.sessionToken))) as any;
		expect(updated.name).toBe('Defects');
		expect(updated.color).toBe('#00ff00');
	});

	it('rejects a caller without ManageSettings', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/projects/index.post');
		mockBody({ name: 'Bugs' });
		await post(eventFor(getRuntime().env, admin.sessionToken));

		const agent = await seedAgent(getRuntime());
		const patch = await importRoute('~/server/api/projects/[id]/index.patch');
		mockParams({ id: 1 });
		mockBody({ name: 'Nope' });
		await expect(patch(eventFor(getRuntime().env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});
});

describe('DELETE /api/projects/[id]', () => {
	it('deletes a project', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/projects/index.post');
		mockBody({ name: 'Bugs' });
		await post(eventFor(getRuntime().env, admin.sessionToken));

		const del = await importRoute('~/server/api/projects/[id]/index.delete');
		mockParams({ id: 1 });
		await del(eventFor(getRuntime().env, admin.sessionToken));

		const get = await importRoute('~/server/api/projects/index.get');
		const list = (await get(eventFor(getRuntime().env, admin.sessionToken))) as any[];
		expect(list).toHaveLength(0);
	});

	it('returns 404 for a missing project', async () => {
		const admin = await seedAdmin();
		const del = await importRoute('~/server/api/projects/[id]/index.delete');
		mockParams({ id: 999 });
		await expect(del(eventFor(getRuntime().env, admin.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
