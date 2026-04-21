import { allAllShards } from '@earth-app/collegedb';
import { ensureCollegeDB } from 'hub:db:schema';
import { DBUser } from '~/server/db/schema';
import { cache, decryptUser, query } from '~/server/utils';

export default defineEventHandler(async (event) => {
	const { search, page, limit, offset, sort, sort_direction } = query(event, [
		'username',
		'created_at'
	]);
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const masterKey = env.MASTER_KEY;
	const cacheKey = `smoke:cache:user:list:${search}:${page}:${limit}:${sort}:${sort_direction}`;
	return await cache(
		cacheKey,
		async () => {
			const users = await allAllShards<DBUser>(
				`SELECT id, username, data, wrapped_dek, nonce, tag, algorithm, version, created_at FROM users WHERE username LIKE ? ORDER BY ${sort} ${sort_direction} LIMIT ? OFFSET ?`,
				[`%${search}%`, limit, offset]
			).then((results) => results.flatMap((row) => row.results ?? []));

			const decryptedUsers = await Promise.all(
				users.map(async (user) => await decryptUser(user, masterKey))
			);

			return decryptedUsers;
		},
		60
	);
});
