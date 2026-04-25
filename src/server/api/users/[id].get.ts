import { first, firstByLookupKey } from '@earth-app/collegedb';
import { DBUser, ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { cache, decryptUser } from '~/server/utils';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.id.or(schemas.usernameParam).or(z.literal('current')) }).parse
	);
	const masterKey = env.MASTER_KEY;
	const cacheKey = `smoke:cache:user:${id}`;

	if (id === 'current') {
		throw createError({
			statusCode: 501,
			message: "'current' user lookup is not implemented yet"
		});
	}

	const operator = id.startsWith('@') ? 'username' : 'id';
	const searchFor = id.startsWith('@') ? id.slice(1) : id;

	return await cache(
		cacheKey,
		async () => {
			const user = id.startsWith('@')
				? await firstByLookupKey<DBUser>(
						`username:${searchFor}`,
						`SELECT id, username, data, wrapped_dek, nonce, tag, algorithm, version, created_at FROM users WHERE username = ?`,
						[searchFor]
					)
				: await first<DBUser>(
						searchFor,
						`SELECT id, username, data, wrapped_dek, nonce, tag, algorithm, version, created_at FROM users WHERE id = ?`,
						[searchFor]
					);

			if (!user) {
				throw createError({
					statusCode: 404,
					message: 'User not found',
					data: { [operator]: searchFor }
				});
			}

			return await decryptUser(user, masterKey);
		},
		60
	);
});
