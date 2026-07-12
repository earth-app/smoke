import type { H3Event } from 'h3';
import type { DBUser } from 'hub:db:schema';
import { ensureCollegeDB } from 'hub:db:schema';
import { kv } from 'hub:kv';

const SESSION_TOKEN_BYTES = 48;
const SESSION_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14;
const MAX_SESSION_TOKENS_PER_USER = 5;

// #region session tokens

async function generateSessionToken(): Promise<[string, string]> {
	const token = bytesToBase64Url(randomBytes(SESSION_TOKEN_BYTES));
	const tokenHash = await hashSessionToken(token);
	return [token, tokenHash];
}

function parseTokenHashFromSessionKey(key: string): string | null {
	const parts = key.split(':');
	return parts[3] ?? null;
}

export async function createSessionToken(userId: string): Promise<string> {
	const [token, tokenHash] = await generateSessionToken();

	// keep only a small number of active tokens per user
	const prefix = `smoke:session_token_hash:${userId}:`;
	const keys = await kv.keys(prefix);
	if (keys.length >= MAX_SESSION_TOKENS_PER_USER) {
		const keysToDelete = keys.slice(0, keys.length - (MAX_SESSION_TOKENS_PER_USER - 1));
		await Promise.all(
			keysToDelete.map(async (key) => {
				const oldTokenHash = parseTokenHashFromSessionKey(key);
				const operations: Promise<void>[] = [kv.del(key)];
				if (oldTokenHash) {
					operations.push(kv.del(`smoke:session_token_user:${oldTokenHash}`));
				}
				await Promise.all(operations);
			})
		);
	}

	// store both forward and reverse indexes for O(1) lookup in ensureLoggedIn
	const tokenHashKey = `${prefix}${tokenHash}`;
	const tokenUserKey = `smoke:session_token_user:${tokenHash}`;
	await Promise.all([
		kv.set(tokenHashKey, '1', { ttl: SESSION_TOKEN_TTL_SECONDS }),
		kv.set(tokenUserKey, userId, { ttl: SESSION_TOKEN_TTL_SECONDS })
	]);

	return token;
}

export async function deleteSessionTokens(userId: string): Promise<void> {
	const prefix = `smoke:session_token_hash:${userId}:`;
	const keys = await kv.keys(prefix);

	await Promise.all(
		keys.map(async (key) => {
			const tokenHash = parseTokenHashFromSessionKey(key);
			const operations: Promise<void>[] = [kv.del(key)];
			if (tokenHash) {
				operations.push(kv.del(`smoke:session_token_user:${tokenHash}`));
			}
			await Promise.all(operations);
		})
	);
}

async function validateSessionToken(userId: string, tokenHash: string): Promise<boolean> {
	const tokenHashKey = `smoke:session_token_hash:${userId}:${tokenHash}`;
	const exists = await kv.get<string>(tokenHashKey);
	// some kv backends coerce the stored '1' to number 1 on read
	return String(exists) === '1';
}

async function getSessionTokenLookup(
	token: string
): Promise<{ userId: string; tokenHash: string } | null> {
	const tokenHash = await hashSessionToken(token);
	const userId = await kv.get<string>(`smoke:session_token_user:${tokenHash}`);
	if (!userId) {
		return null;
	}

	return { userId, tokenHash };
}

async function hashSessionToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(token));
	return bytesToHex(new Uint8Array(digest));
}

// #endregion

export async function ensureLoggedIn(event: H3Event): Promise<User> {
	const rawAuthHeader = event.node.req.headers['authorization'];
	const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		throw createError({
			statusCode: 401,
			message: 'Missing or invalid Authorization header'
		});
	}

	const token = authHeader.slice(7).trim();
	if (!token) {
		throw createError({
			statusCode: 401,
			message: 'Invalid session token'
		});
	}

	const lookup = await getSessionTokenLookup(token);
	if (!lookup) {
		throw createError({
			statusCode: 401,
			message: 'Invalid session token'
		});
	}

	const validToken = await validateSessionToken(lookup.userId, lookup.tokenHash);
	if (!validToken) {
		throw createError({
			statusCode: 401,
			message: 'Invalid session token'
		});
	}

	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	// Reuse the cached decrypted user so the per-request hot path skips PBKDF2 KEK derivation.
	const user = await getUserById(lookup.userId, env);
	if (!user) {
		throw createError({
			statusCode: 401,
			message: 'User not found for session token'
		});
	}
	return user;
}

export async function getOptionalLoggedIn(event: H3Event): Promise<User | null> {
	const rawAuthHeader = event.node.req.headers['authorization'];
	const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return null;
	}

	try {
		return await ensureLoggedIn(event);
	} catch (error) {
		if (isError(error)) {
			return null;
		}

		throw error;
	}
}

export function canViewPrivateTicket(current: User | null, ticket: Ticket): boolean {
	const visibility =
		ticket.visibility ?? (ticket.private ? TicketVisibility.Private : TicketVisibility.Public);

	// public: anyone (incl. the anonymous customer holding a status token)
	if (visibility === TicketVisibility.Public) {
		return true;
	}

	if (!current) {
		return false;
	}

	// internal: any signed-in staff member
	if (visibility === TicketVisibility.Internal) {
		return true;
	}

	// private: needs a viewing permission or being an assignee
	if (
		current.permissions.includes(Permission.ViewPrivateTickets) ||
		current.permissions.includes(Permission.ManageTicket) ||
		current.permissions.includes(Permission.ManageTicketMessages)
	) {
		return true;
	}

	return ticket.assignees.some((assignee) => assignee.id === current.id);
}

export async function ensureCanWriteTo(current: User, target: User): Promise<void> {
	if (current.role === Role.Admin) return;
	if (current.permissions?.includes(Permission.ManageUsers)) return;

	if (current.id === target.id) {
		if (current.permissions?.includes(Permission.ManageSelf)) return;

		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action on yourself'
		});
	}

	throw createError({
		statusCode: 403,
		message: 'You do not have permission to perform this action'
	});
}

export async function logIn(
	usernameOrEmail: string,
	password: string,
	event: H3Event
): Promise<{ user: User; sessionToken: string }> {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(usernameOrEmail);
	const lookupKey = isEmail ? `email_lookup:${usernameOrEmail}` : `username:${usernameOrEmail}`;

	const USER_SELECT_COLUMNS = `id, username, created_at, updated_at, data, wrapped_dek, nonce, tag, algorithm, version, password_hash, password_salt, password_algorithm`;

	let user: DBUser | null = null;
	if (isEmail) {
		// only compute hash if guarenteed to be an email
		const email0 = usernameOrEmail.trim().toLowerCase();
		const emailLookupHash = await hmacSha256(env.HMAC_SECRET, email0);
		user = await firstRowByLookup<DBUser>(
			lookupKey,
			`SELECT ${USER_SELECT_COLUMNS} FROM users WHERE email_lookup = ?`,
			[emailLookupHash]
		);
	} else {
		const username0 = usernameOrEmail.trim();
		user = await firstRowByLookup<DBUser>(
			lookupKey,
			`SELECT ${USER_SELECT_COLUMNS} FROM users WHERE username = ?`,
			[username0]
		);
	}

	// throw 400 if password_hash is empty (password must be set separately)
	if (user && !user.password_hash) {
		throw createError({
			statusCode: 400,
			message: 'Password must be set for this user before logging in'
		});
	}

	if (!user) {
		throw createError({
			statusCode: 401,
			message: 'Invalid username or password'
		});
	}

	const passwordValid = await verifyPassword(
		password,
		toUint8Array(user.password_hash, 'password_hash'),
		toUint8Array(user.password_salt, 'password_salt'),
		user.password_algorithm as PasswordAlgorithm
	);

	if (!passwordValid) {
		throw createError({
			statusCode: 401,
			message: 'Invalid username or password'
		});
	}

	const sessionToken = await createSessionToken(user.id);
	const decryptedUser = await decryptUser(user, env.MASTER_KEY);

	await recordAudit(env, {
		action: 'auth.login',
		actorId: decryptedUser.id,
		actorName: displayName(decryptedUser) || decryptedUser.username,
		targetType: 'user',
		targetId: decryptedUser.id,
		priority: 'low',
		summary: `Signed in as @${decryptedUser.username}`
	});

	return { user: decryptedUser, sessionToken };
}

export async function logOut(event: H3Event): Promise<void> {
	const rawAuthHeader = event.node.req.headers['authorization'];
	const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		throw createError({
			statusCode: 401,
			message: 'Missing or invalid Authorization header'
		});
	}

	const token = authHeader.slice(7).trim();
	if (!token) {
		throw createError({
			statusCode: 401,
			message: 'Invalid session token'
		});
	}

	const lookup = await getSessionTokenLookup(token);
	if (!lookup) {
		throw createError({
			statusCode: 401,
			message: 'Invalid session token'
		});
	}

	await kv.del(`smoke:session_token_user:${lookup.tokenHash}`);
	await kv.del(`smoke:session_token_hash:${lookup.userId}:${lookup.tokenHash}`);

	await recordAudit(event.context.cloudflare.env, {
		action: 'auth.logout',
		actorId: lookup.userId,
		targetType: 'user',
		targetId: lookup.userId,
		priority: 'low',
		summary: 'Signed out'
	});
}
