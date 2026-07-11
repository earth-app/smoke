import { allAllShardsGlobal, run } from '@earth-app/collegedb';
import type { H3Event } from 'h3';
import type { DBUser } from 'hub:db:schema';
import { ensureCollegeDB } from 'hub:db:schema';

// #region encryption

export async function decryptUser(
	user: Omit<DBUser, 'email_lookup' | 'password_hash' | 'password_salt' | 'password_algorithm'>,
	masterKey: string
): Promise<User> {
	const decrypted = asObject(
		await decrypt(
			{
				data: toUint8Array(user.data, 'data'),
				wrapped_dek: toUint8Array(user.wrapped_dek, 'wrapped_dek'),
				nonce: toUint8Array(user.nonce, 'nonce'),
				tag: toUint8Array(user.tag, 'tag'),
				algorithm: toEncryptionAlgorithm(user.algorithm),
				version: Number(user.version)
			},
			masterKey
		)
	);

	return {
		id: user.id,
		username: user.username,
		email: typeof decrypted.email === 'string' ? decrypted.email : '',
		name: typeof decrypted.name === 'string' ? decrypted.name : undefined,
		first_name: typeof decrypted.first_name === 'string' ? decrypted.first_name : undefined,
		last_name: typeof decrypted.last_name === 'string' ? decrypted.last_name : undefined,
		avatar_url: typeof decrypted.avatar_url === 'string' ? decrypted.avatar_url : undefined,
		role: decrypted.role as Role,
		permissions: Array.isArray(decrypted.permissions)
			? (decrypted.permissions as Permission[])
			: [],
		labels: Array.isArray(decrypted.labels) ? (decrypted.labels as Label[]) : [],
		created_at: new Date(Number(user.created_at) * 1000),
		updated_at: new Date(Number(user.updated_at) * 1000)
	};
}

export async function decryptUsers(users: DBUser[], masterKey: string): Promise<User[]> {
	const decrypted = await Promise.allSettled(
		users.map(async (user) => await decryptUser(user, masterKey))
	);

	const failed = decrypted.filter((r) => r.status === 'rejected');
	if (failed.length > 0) {
		console.error(
			`User decryption failed on ${failed.length} shards`,
			failed.map((r) => r.reason || 'Unknown')
		);
	}

	return decrypted.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}

// #endregion

// #region owner

// the founding admin (set at setup); their role + permissions are locked
const OWNER_KEY = 'smoke:owner_user';

export async function getOwnerUserId(): Promise<string | null> {
	try {
		return (await kv.get<string>(OWNER_KEY)) ?? null;
	} catch {
		return null;
	}
}

export async function setOwnerUserId(id: string): Promise<void> {
	await kv.set(OWNER_KEY, id);
}

export async function isOwnerUser(id: string): Promise<boolean> {
	return (await getOwnerUserId()) === id;
}

// #endregion

// #region crud

function generateUserId() {
	const uuid = crypto.randomUUID();
	return uuid.replace(/-/g, '');
}

export async function createUser(
	username: string,
	email: string,
	role: Role = Role.Agent,
	env: any
): Promise<{ id: string; sessionToken: string }> {
	const id = generateUserId();
	const nowSeconds = Math.floor(Date.now() / 1000);

	const encrypted = await encrypt(
		{
			email,
			role,
			permissions: DEFAULT_PERMISSIONS[role],
			labels: []
		},
		env.MASTER_KEY
	);

	const email0 = email.trim().toLowerCase();
	const emailLookupHash = await hmacSha256(env.HMAC_SECRET, email0);

	await run(
		id,
		`INSERT INTO users (id, username, created_at, updated_at, data, email_lookup, wrapped_dek, nonce, tag, algorithm, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			username,
			nowSeconds,
			nowSeconds,
			encrypted.ciphertext,
			emailLookupHash,
			encrypted.wrapped_dek,
			encrypted.nonce,
			encrypted.tag,
			encrypted.algorithm,
			encrypted.version
		]
	);

	const sessionToken = await createSessionToken(id);
	return { id, sessionToken };
}

// not change password; admins create users so they need to set an initial password,
// but changing passwords is a separate flow
export async function setInitialPassword(userId: string, newPassword: string): Promise<void> {
	const existing = await firstRow<{ password_hash: Uint8Array | null }>(
		userId,
		`SELECT password_hash FROM users WHERE id = ?`,
		[userId]
	);

	if (!existing) {
		throw createError({
			statusCode: 404,
			message: 'User not found'
		});
	}

	// ensure no password has been set yet
	if (existing.password_hash) {
		throw createError({
			statusCode: 400,
			message: 'Password has already been set for this user'
		});
	}

	const { password_hash, password_salt, password_algorithm } = await hashPassword(newPassword);
	await run(
		userId,
		`UPDATE users SET password_hash = ?, password_salt = ?, password_algorithm = ? WHERE id = ?`,
		[password_hash, password_salt, password_algorithm, userId]
	);
}

// overwrite an existing password (reset flow); unlike setInitialPassword there's no already-set guard
export async function setUserPassword(userId: string, newPassword: string): Promise<void> {
	const existing = await firstRow<{ id: string }>(userId, `SELECT id FROM users WHERE id = ?`, [
		userId
	]);
	if (!existing) {
		throw createError({ statusCode: 404, message: 'User not found' });
	}

	const { password_hash, password_salt, password_algorithm } = await hashPassword(newPassword);
	await run(
		userId,
		`UPDATE users SET password_hash = ?, password_salt = ?, password_algorithm = ? WHERE id = ?`,
		[password_hash, password_salt, password_algorithm, userId]
	);
}

export async function patchUser(
	user: User,
	updates: Partial<Omit<User, 'id' | 'created_at' | 'updated_at'>>,
	env: any
): Promise<User> {
	const merged: User = { ...user, ...updates, updated_at: new Date() };

	// a last name without a first name is dropped (display falls back cleanly)
	if (!merged.first_name) merged.last_name = undefined;

	// holding a permission implies its prerequisites; keep the stored set consistent
	if (updates.permissions !== undefined) {
		merged.permissions = expandPermissions(updates.permissions);
	}

	// the founding owner can never be demoted or lose permissions, however the patch arrives
	if (await isOwnerUser(user.id)) {
		merged.role = Role.Admin;
		merged.permissions = DEFAULT_PERMISSIONS[Role.Admin];
	}

	const encrypted = await encrypt(
		{
			email: merged.email,
			name: merged.name,
			first_name: merged.first_name,
			last_name: merged.last_name,
			avatar_url: merged.avatar_url,
			role: merged.role,
			permissions: merged.permissions,
			labels: merged.labels
		},
		env.MASTER_KEY
	);

	await run(
		user.id,
		`UPDATE users SET data = ?, wrapped_dek = ?, nonce = ?, tag = ?, algorithm = ?, version = ?, updated_at = ? WHERE id = ?`,
		[
			encrypted.ciphertext,
			encrypted.wrapped_dek,
			encrypted.nonce,
			encrypted.tag,
			encrypted.algorithm,
			encrypted.version,
			Math.floor(merged.updated_at.getTime() / 1000),
			user.id
		]
	);

	if (updates.username) {
		await run(user.id, `UPDATE users SET username = ? WHERE id = ?`, [updates.username, user.id]);
	}

	if (updates.email) {
		// email was included as apart of encrypted payload, so just update the lookup hash
		const email0 = updates.email.trim().toLowerCase();
		const emailLookupHash = await hmacSha256(env.HMAC_SECRET, email0);
		await run(user.id, `UPDATE users SET email_lookup = ? WHERE id = ?`, [
			emailLookupHash,
			user.id
		]);
	}

	await kv.del(`smoke:cache:user_id:${user.id}`);
	await kv.del(`smoke:cache:user_username:${user.username}`);
	if (updates.username && updates.username !== user.username) {
		await kv.del(`smoke:cache:user_username:${updates.username}`);
	}

	return merged;
}

export async function deleteUser(userId: string): Promise<void> {
	await Promise.allSettled([
		run(userId, `DELETE FROM users WHERE id = ?`, [userId]),
		deleteSessionTokens(userId),
		kv.del(`smoke:cache:user_id:${userId}`)
	]);
}

export async function listUsers(
	env: any,
	search: string,
	page: number,
	limit: number,
	offset: number,
	sort: string,
	sort_direction: 'asc' | 'desc'
): Promise<User[]> {
	const masterKey = env.MASTER_KEY;
	const cacheKey = `smoke:cache:user:list:${search}:${page}:${limit}:${sort}:${sort_direction}`;
	const sortableFields: Array<keyof User> = [
		'id',
		'username',
		'email',
		'name',
		'avatar_url',
		'role',
		'permissions',
		'created_at',
		'updated_at'
	];
	const sortKey = (sortableFields.includes(sort as keyof User) ? sort : 'id') as keyof DBUser;

	return await cache(cacheKey, async () => {
		const sql = search
			? `SELECT ${USER_LIST_COLUMNS} FROM users WHERE username LIKE ?`
			: `SELECT ${USER_LIST_COLUMNS} FROM users`;
		const bindings = search ? [`%${search}%`] : [];

		const result = await allAllShardsGlobal<DBUser>(sql, bindings, {
			sortBy: sortKey,
			sortDirection: sort_direction as 'asc' | 'desc',
			offset,
			limit
		});

		return await decryptUsers(result.results, masterKey);
	});
}

const USER_LIST_COLUMNS = `id, username, created_at, updated_at, data, wrapped_dek, nonce, tag, algorithm, version`;
const USER_FETCH_COLUMNS = `${USER_LIST_COLUMNS}, password_hash, password_salt, password_algorithm`;

export async function getUserById(id: string, env: any): Promise<User | null> {
	const cacheKey = `smoke:cache:user_id:${id}`;
	return await cache(
		cacheKey,
		async () => {
			const user = await firstRow<DBUser>(
				id,
				`SELECT ${USER_FETCH_COLUMNS} FROM users WHERE id = ?`,
				[id]
			);

			if (!user) return null;
			return await decryptUser(user, env.MASTER_KEY);
		},
		14400
	);
}

export async function getUserByUsername(username: string, env: any): Promise<User | null> {
	const cacheKey = `smoke:cache:user_username:${username}`;
	return await cache(
		cacheKey,
		async () => {
			const user = await firstRowByLookup<DBUser>(
				`username:${username}`,
				`SELECT ${USER_FETCH_COLUMNS} FROM users WHERE username = ?`,
				[username]
			);

			if (!user) return null;
			return await decryptUser(user, env.MASTER_KEY);
		},
		14400
	);
}

export async function getUserByEmail(email: string, env: any): Promise<User | null> {
	const email0 = email.trim().toLowerCase();
	const emailLookupHash = await hmacSha256(env.HMAC_SECRET, email0);

	const cacheKey = `smoke:cache:user_email:${emailLookupHash}`;
	return await cache(
		cacheKey,
		async () => {
			const user = await firstRowByLookup<DBUser>(
				`email_lookup:${emailLookupHash}`,
				`SELECT ${USER_FETCH_COLUMNS} FROM users WHERE email_lookup = ?`,
				[emailLookupHash]
			);

			if (!user) return null;
			return await decryptUser(user, env.MASTER_KEY);
		},
		14400
	);
}

// username, id, or 'current' for logged in user
export async function getUserBy(value: string, event: H3Event): Promise<User | null> {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	if (value === 'current') {
		return await ensureLoggedIn(event);
	}

	const isUsername = value.startsWith('@');
	if (isUsername) {
		const username = value.slice(1);
		return await getUserByUsername(username, env);
	}

	return await getUserById(value, env);
}

// #endregion
