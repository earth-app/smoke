import { allAllShardsGlobal } from '@earth-app/collegedb';
import { DBUser, ensureCollegeDB } from 'hub:db:schema';
import { cache, decryptUsers, query } from '~/server/utils';

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
			const sql = search
				? 'SELECT id, username, data, wrapped_dek, nonce, tag, algorithm, version, created_at FROM users WHERE username LIKE ?'
				: 'SELECT id, username, data, wrapped_dek, nonce, tag, algorithm, version, created_at FROM users';
			const bindings = search ? [`%${search}%`] : [];

			const result = await allAllShardsGlobal<DBUser>(sql, bindings, {
				sortBy: sort as keyof DBUser,
				sortDirection: sort_direction as 'asc' | 'desc',
				offset,
				limit
			});

			return await decryptUsers(result.results, masterKey);
		},
		60
	);
});
