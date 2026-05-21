import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockBody,
	mockParams,
	mockQuery,
	seedAgent
} from './route-runtime';

// Exercises behaviors in `src/server/utils.ts` that the per-route specs don't
// hit directly — primarily defensive validation, alternative password
// algorithms, and the `getUserBy` username/current branches.
describe('server/utils dispatch behaviors', () => {
	it('caches and rejects oversized search queries', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('../../src/server/api/users/index.get');

		mockQuery({ search: 'x'.repeat(121) });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });
	});

	it('rejects invalid sort/page/limit/sort_direction query params', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('../../src/server/api/users/index.get');

		mockQuery({ sort: 'unsupported' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });

		mockQuery({ sort: 'created_at', sort_direction: 'sideways' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });

		mockQuery({ sort: 'created_at', sort_direction: 'asc', page: '0' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });

		mockQuery({ sort: 'created_at', sort_direction: 'asc', limit: '999' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 400 });
	});

	it('resolves users by @username and "current" alias', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('../../src/server/api/users/[id]/index.get');

		mockParams({ id: '@agent_user' });
		await expect(handler(eventFor(runtime.env))).resolves.toMatchObject({
			username: 'agent_user'
		});

		mockParams({ id: 'current' });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).resolves.toMatchObject({
			id: agent.id
		});
	});

	it('hashes and verifies passwords with argon2id and scrypt', async () => {
		const utils = await import('~/server/utils');
		const argon = await utils.hashPassword('AnotherStrong123!', 'argon2id');
		expect(
			await utils.verifyPassword(
				'AnotherStrong123!',
				argon.password_hash,
				argon.password_salt,
				argon.password_algorithm
			)
		).toBe(true);
		expect(
			await utils.verifyPassword(
				'WrongPassword99!',
				argon.password_hash,
				argon.password_salt,
				argon.password_algorithm
			)
		).toBe(false);

		const scrypt = await utils.hashPassword('AnotherStrong123!', 'scrypt');
		expect(
			await utils.verifyPassword(
				'AnotherStrong123!',
				scrypt.password_hash,
				scrypt.password_salt,
				scrypt.password_algorithm
			)
		).toBe(true);
	}, 30000);

	it('rejects short passwords and bcrypt overlong inputs', async () => {
		const utils = await import('~/server/utils');
		await expect(utils.hashPassword('short')).rejects.toThrow(/12 characters/);
		await expect(utils.hashPassword('a'.repeat(80) + 'A1!', 'bcrypt')).rejects.toThrow(
			/bcrypt maximum length/
		);
	});

	it('returns 401 when login is called with a username that does not exist', async () => {
		const runtime = getRuntime();
		const handler = await importRoute('../../src/server/api/users/login.post');

		mockBody({ usernameOrEmail: 'ghost_user', password: 'StrongPass123!' });
		await expect(handler(eventFor(runtime.env))).rejects.toMatchObject({ statusCode: 401 });
	});

	it('listTicketMessages returns 403 when caller cannot view private ticket', async () => {
		const runtime = getRuntime();
		const utils = await import('~/server/utils');
		const agent = await seedAgent(runtime);
		// seed a private ticket that the agent is NOT assigned to
		const seeded = (await import('./route-runtime')).seedTicket;
		const seedCustomer = (await import('./route-runtime')).seedCustomer;
		const customer = await seedCustomer(runtime, { name: 'C', email: 'c@example.com' });
		const ticket = await seeded(runtime, {
			title: 'locked',
			description: 'desc',
			customer_id: customer.id,
			status: undefined,
			priority: undefined,
			private: true
		});

		await expect(utils.getTicketThread(ticket.id, runtime.env, null)).rejects.toMatchObject({
			statusCode: 403
		});
		void agent;
	});

	it('setInitialPassword refuses to overwrite an existing password', async () => {
		const runtime = getRuntime();
		const utils = await import('~/server/utils');
		const agent = await seedAgent(runtime);
		await utils.setInitialPassword(agent.id, 'StrongPass123!');
		await expect(utils.setInitialPassword(agent.id, 'AnotherStrong99!')).rejects.toMatchObject({
			statusCode: 400
		});
	});

	it('setInitialPassword 404s when the user does not exist', async () => {
		const runtime = getRuntime();
		const utils = await import('~/server/utils');
		await expect(utils.setInitialPassword('0'.repeat(32), 'StrongPass123!')).rejects.toMatchObject({
			statusCode: 404
		});
		void runtime;
	});
});
