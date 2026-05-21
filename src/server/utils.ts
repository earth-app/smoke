import {
	allAllShardsGlobal,
	first,
	firstByLookupKey,
	QueryResult,
	run
} from '@earth-app/collegedb';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import bcrypt from 'bcryptjs';
import type { H3Event } from 'h3';
import { kv } from 'hub:kv';
import {
	Ticket,
	TicketActor,
	TicketAttachment,
	TicketAttachmentInput,
	TicketCreateInput,
	TicketMessage,
	TicketMessageInput,
	TicketPatchInput,
	TicketPriority,
	TicketStatus,
	TicketThread
} from '~/shared/types/ticket';
import {
	DEFAULT_PERMISSIONS,
	Label,
	Permission,
	Role,
	type Customer,
	type User
} from '~/shared/types/user';
import {
	ensureCollegeDB,
	type DBCustomer,
	type DBLabel,
	type DBTicket,
	type DBUser
} from './db/schema';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const ENCRYPTION_VERSION = 1;
const WRAPPED_DEK_VERSION = 1;
const AES_GCM_KEY_BYTES = 32;

const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const WRAP_SALT_BYTES = 16;

const PASSWORD_SALT_BYTES = 16;
const BCRYPT_ROUNDS = 12;
const SESSION_TOKEN_BYTES = 48;
const SESSION_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14;
const MAX_SESSION_TOKENS_PER_USER = 5;
const CUSTOMER_EMAIL_LOOKUP_PREFIX = 'smoke:customer_email_hash:';

export type PasswordAlgorithm = 'bcrypt' | 'argon2id' | 'scrypt';
export type EncryptionAlgorithm = PasswordAlgorithm | 'aes-256-gcm';

// #endregion

// #region Requests

export async function cache<T>(
	key: string,
	fetcher: () => Promise<T>,
	ttlSeconds: number = 60
): Promise<T> {
	const cached = await kv.get<string>(key);
	if (typeof cached === 'string') {
		try {
			return JSON.parse(cached) as T;
		} catch (error) {
			await kv.del(key);
			console.warn(
				`Failed to parse cached data for key ${key}. Cache entry deleted. Error:`,
				error
			);
		}
	}

	const data = await fetcher();
	await kv.set(key, JSON.stringify(data), { ttl: ttlSeconds });
	return data;
}

function isHttpError(error: unknown): error is { statusCode?: number } {
	return typeof error === 'object' && error !== null && 'statusCode' in error;
}

export function primitiveQuery(event: H3Event, sortFields: string[] = ['created_at']) {
	const { search, sort, sort_direction } = getQuery(event);

	const search0 = search?.toString() || '';
	if (search0.length > 120) {
		throw createError({
			statusCode: 400,
			message: 'Search parameter too long, max is 120 characters',
			data: { search: search0 }
		});
	}

	const validSortDirections = ['asc', 'desc'];
	const sort0 = sort?.toString() || 'created_at';
	if (!sortFields.includes(sort0)) {
		throw createError({
			statusCode: 400,
			message: `Invalid sort parameter, must be one of: ${sortFields.join(', ')}`,
			data: { sort }
		});
	}

	const sort_direction0: 'asc' | 'desc' = (sort_direction?.toString() as 'asc' | 'desc') || 'desc';
	if (!validSortDirections.includes(sort_direction0)) {
		throw createError({
			statusCode: 400,
			message: `Invalid sort_direction parameter, must be one of: ${validSortDirections.join(', ')}`,
			data: { sort_direction }
		});
	}

	return {
		search: search0,
		sort: sort0,
		sort_direction: sort_direction0
	};
}

export function query(event: H3Event, sortFields: string[] = ['created_at']) {
	const { search, sort, sort_direction } = primitiveQuery(event, sortFields);
	const { page, limit } = getQuery(event);

	const page0 = page ? parseInt(page as string, 10) : 1;
	if (isNaN(page0) || page0 < 1) {
		throw createError({
			statusCode: 400,
			message: 'Invalid page parameter, must be a positive integer',
			data: { page }
		});
	}

	const limit0 = limit ? parseInt(limit as string, 10) : 10;
	if (isNaN(limit0) || limit0 < 1 || limit0 > 100) {
		throw createError({
			statusCode: 400,
			message: 'Invalid limit parameter, must be a positive integer between 1 and 100',
			data: { limit }
		});
	}

	return {
		search,
		page: page0,
		limit: limit0,
		offset: (page0 - 1) * limit0,
		sort,
		sort_direction
	};
}

// #endregion

// #region Encryption + Hashing

export function toUint8Array(value: unknown, field: string): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}

	throw createError({
		statusCode: 500,
		message: `Unexpected binary type for ${field}`
	});
}

export function toEncryptionAlgorithm(value: unknown): EncryptionAlgorithm {
	if (value === 'bcrypt' || value === 'argon2id' || value === 'scrypt' || value === 'aes-256-gcm') {
		return value;
	}

	throw createError({
		statusCode: 500,
		message: 'Invalid encryption algorithm on user record'
	});
}

export function asObject(value: unknown): Record<string, unknown> {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}

	return { payload: value };
}

function randomBytes(length: number): Uint8Array {
	const out = new Uint8Array(length);
	crypto.getRandomValues(out);
	return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const size = parts.reduce((sum, current) => sum + current.length, 0);
	const out = new Uint8Array(size);

	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}

	return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;

	let diff = 0;
	for (let i = 0; i < a.length; i += 1) {
		diff |= a[i]! ^ b[i]!;
	}

	return diff === 0;
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
	if (
		bytes.buffer instanceof ArrayBuffer &&
		bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength
	) {
		return bytes.buffer;
	}

	return bytes.slice().buffer as ArrayBuffer;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i]!);
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hashSessionToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(token));
	return bytesToHex(new Uint8Array(digest));
}

async function derivePBKDF2Key(masterKey: string, salt: Uint8Array): Promise<Uint8Array> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		textEncoder.encode(masterKey),
		'PBKDF2',
		false,
		['deriveBits']
	);

	const bits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt: toBufferSource(salt),
			iterations: 210_000
		},
		keyMaterial,
		AES_GCM_KEY_BYTES * 8
	);

	return new Uint8Array(bits);
}

async function deriveWrapKey(
	masterKey: string,
	algorithm: EncryptionAlgorithm,
	salt: Uint8Array
): Promise<Uint8Array> {
	if (algorithm === 'argon2id') {
		return argon2idAsync(masterKey, salt, {
			t: 2,
			m: 16_384,
			p: 1,
			dkLen: AES_GCM_KEY_BYTES,
			maxmem: 256 * 1024 * 1024,
			asyncTick: 10
		});
	}

	if (algorithm === 'scrypt') {
		return scryptAsync(masterKey, salt, {
			N: 2 ** 15,
			r: 8,
			p: 1,
			dkLen: AES_GCM_KEY_BYTES,
			maxmem: 256 * 1024 * 1024,
			asyncTick: 10
		});
	}

	// bcrypt is intentionally not used as a KEK derivation algorithm for envelope encryption.
	return derivePBKDF2Key(masterKey, salt);
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', toBufferSource(rawKey), { name: 'AES-GCM' }, false, [
		'encrypt',
		'decrypt'
	]);
}

async function wrapKey(
	dek: Uint8Array,
	masterKey: string,
	algorithm: EncryptionAlgorithm
): Promise<Uint8Array> {
	const wrapSalt = randomBytes(WRAP_SALT_BYTES);
	const wrapNonce = randomBytes(AES_GCM_NONCE_BYTES);
	const wrapAad = textEncoder.encode(`smoke:dek:v${WRAPPED_DEK_VERSION}:${algorithm}`);

	const wrapKeyBytes = await deriveWrapKey(masterKey, algorithm, wrapSalt);
	const kek = await importAesKey(wrapKeyBytes);
	const wrappedDek = new Uint8Array(
		await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv: toBufferSource(wrapNonce),
				additionalData: toBufferSource(wrapAad),
				tagLength: AES_GCM_TAG_BYTES * 8
			},
			kek,
			toBufferSource(dek)
		)
	);

	return concatBytes(new Uint8Array([WRAPPED_DEK_VERSION]), wrapSalt, wrapNonce, wrappedDek);
}

async function unwrapKey(
	wrappedDek: Uint8Array,
	masterKey: string,
	algorithm: EncryptionAlgorithm
): Promise<Uint8Array> {
	const minLen = 1 + WRAP_SALT_BYTES + AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES;
	if (wrappedDek.length < minLen) {
		throw new Error('Invalid wrapped DEK payload');
	}

	const version = wrappedDek[0]!;
	if (version !== WRAPPED_DEK_VERSION) {
		throw new Error(`Unsupported wrapped DEK version: ${version}`);
	}

	const wrapSaltStart = 1;
	const wrapSaltEnd = wrapSaltStart + WRAP_SALT_BYTES;
	const wrapNonceEnd = wrapSaltEnd + AES_GCM_NONCE_BYTES;

	const wrapSalt = wrappedDek.slice(wrapSaltStart, wrapSaltEnd);
	const wrapNonce = wrappedDek.slice(wrapSaltEnd, wrapNonceEnd);
	const encryptedDek = wrappedDek.slice(wrapNonceEnd);
	const wrapAad = textEncoder.encode(`smoke:dek:v${WRAPPED_DEK_VERSION}:${algorithm}`);

	const wrapKeyBytes = await deriveWrapKey(masterKey, algorithm, wrapSalt);
	const kek = await importAesKey(wrapKeyBytes);
	const dek = await crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: toBufferSource(wrapNonce),
			additionalData: toBufferSource(wrapAad),
			tagLength: AES_GCM_TAG_BYTES * 8
		},
		kek,
		toBufferSource(encryptedDek)
	);

	return new Uint8Array(dek);
}

export async function encrypt(
	data: object,
	masterKey: string,
	algorithm: EncryptionAlgorithm = 'aes-256-gcm'
): Promise<{
	wrapped_dek: Uint8Array;
	nonce: Uint8Array;
	tag: Uint8Array;
	ciphertext: Uint8Array;
	algorithm: EncryptionAlgorithm;
	version: number;
}> {
	if (!masterKey || masterKey.length < 16) {
		throw new Error('Master key must be at least 16 characters');
	}

	const plaintext = textEncoder.encode(JSON.stringify(data));
	const dek = randomBytes(AES_GCM_KEY_BYTES);
	const nonce = randomBytes(AES_GCM_NONCE_BYTES);
	const aad = textEncoder.encode(`smoke:data:v${ENCRYPTION_VERSION}:${algorithm}`);

	const dataKey = await importAesKey(dek);
	const sealedPayload = new Uint8Array(
		await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv: toBufferSource(nonce),
				additionalData: toBufferSource(aad),
				tagLength: AES_GCM_TAG_BYTES * 8
			},
			dataKey,
			toBufferSource(plaintext)
		)
	);

	const ciphertext = sealedPayload.slice(0, -AES_GCM_TAG_BYTES);
	const tag = sealedPayload.slice(-AES_GCM_TAG_BYTES);
	const wrapped_dek = await wrapKey(dek, masterKey, algorithm);

	return {
		wrapped_dek,
		nonce,
		tag,
		ciphertext,
		algorithm,
		version: ENCRYPTION_VERSION
	};
}

export async function decrypt(
	encrypted: {
		wrapped_dek: Uint8Array;
		nonce: Uint8Array;
		tag: Uint8Array;
		data: Uint8Array;
		algorithm: EncryptionAlgorithm;
		version: number;
	},
	masterKey: string
): Promise<unknown> {
	if (!masterKey || masterKey.length < 16) {
		throw new Error('Master key must be at least 16 characters');
	}

	if (encrypted.version !== ENCRYPTION_VERSION) {
		throw new Error(`Unsupported encryption version: ${encrypted.version}`);
	}

	const dek = await unwrapKey(encrypted.wrapped_dek, masterKey, encrypted.algorithm);
	const dataKey = await importAesKey(dek);
	const aad = textEncoder.encode(`smoke:data:v${encrypted.version}:${encrypted.algorithm}`);
	const sealedPayload = concatBytes(encrypted.data, encrypted.tag);

	const plaintext = await crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: toBufferSource(encrypted.nonce),
			additionalData: toBufferSource(aad),
			tagLength: AES_GCM_TAG_BYTES * 8
		},
		dataKey,
		toBufferSource(sealedPayload)
	);

	return JSON.parse(textDecoder.decode(new Uint8Array(plaintext)));
}

export async function hashPassword(
	password: string,
	algorithm: PasswordAlgorithm = 'argon2id'
): Promise<{
	password_hash: Uint8Array;
	password_salt: Uint8Array;
	password_algorithm: PasswordAlgorithm;
}> {
	if (password.length < 12) {
		throw new Error('Password must be at least 12 characters');
	}

	if (algorithm === 'bcrypt') {
		if (bcrypt.truncates(password)) {
			throw new Error('Password exceeds bcrypt maximum length of 72 bytes');
		}

		const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
		const hash = await bcrypt.hash(password, salt);

		return {
			password_hash: textEncoder.encode(hash),
			password_salt: textEncoder.encode(salt),
			password_algorithm: 'bcrypt'
		};
	}

	const salt = randomBytes(PASSWORD_SALT_BYTES);

	if (algorithm === 'argon2id') {
		const hash = await argon2idAsync(password, salt, {
			t: 3,
			m: 19_456,
			p: 1,
			dkLen: 32,
			maxmem: 256 * 1024 * 1024,
			asyncTick: 10
		});

		return {
			password_hash: hash,
			password_salt: salt,
			password_algorithm: 'argon2id'
		};
	}

	const hash = await scryptAsync(password, salt, {
		N: 2 ** 15,
		r: 8,
		p: 1,
		dkLen: 32,
		maxmem: 256 * 1024 * 1024,
		asyncTick: 10
	});

	return {
		password_hash: hash,
		password_salt: salt,
		password_algorithm: 'scrypt'
	};
}

export async function verifyPassword(
	password: string,
	hash: Uint8Array,
	salt: Uint8Array,
	algorithm: PasswordAlgorithm
): Promise<boolean> {
	if (algorithm === 'bcrypt') {
		try {
			const hashText = textDecoder.decode(hash);
			const saltText = textDecoder.decode(salt);
			if (!hashText.startsWith(saltText)) {
				return false;
			}
			return await bcrypt.compare(password, hashText);
		} catch {
			return false;
		}
	}

	if (!salt.length || !hash.length) {
		return false;
	}

	if (algorithm === 'argon2id') {
		const computed = await argon2idAsync(password, salt, {
			t: 3,
			m: 19_456,
			p: 1,
			dkLen: 32,
			maxmem: 256 * 1024 * 1024,
			asyncTick: 10
		});
		return timingSafeEqual(computed, hash);
	}

	const computed = await scryptAsync(password, salt, {
		N: 2 ** 15,
		r: 8,
		p: 1,
		dkLen: 32,
		maxmem: 256 * 1024 * 1024,
		asyncTick: 10
	});

	return timingSafeEqual(computed, hash);
}

async function hmacSha256(secret: string, input: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		textEncoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);

	const bytes = await crypto.subtle
		.sign('HMAC', key, textEncoder.encode(input))
		.then((digest) => new Uint8Array(digest));

	return bytesToHex(bytes);
}

// #region Storing Types

async function decryptUser(
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

async function decryptUsers(users: DBUser[], masterKey: string): Promise<User[]> {
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

async function decryptCustomer(customer: DBCustomer, masterKey: string): Promise<Customer> {
	const decrypted = await decrypt(
		{
			data: toUint8Array(customer.data, 'data'),
			wrapped_dek: toUint8Array(customer.wrapped_dek, 'wrapped_dek'),
			nonce: toUint8Array(customer.nonce, 'nonce'),
			tag: toUint8Array(customer.tag, 'tag'),
			algorithm: toEncryptionAlgorithm(customer.algorithm),
			version: Number(customer.version)
		},
		masterKey
	);
	const payload = asObject(decrypted);
	const createdAtValue = payload.created_at ? new Date(String(payload.created_at)) : null;
	const updatedAtValue = payload.updated_at ? new Date(String(payload.updated_at)) : null;
	const createdAt =
		createdAtValue && !Number.isNaN(createdAtValue.getTime())
			? createdAtValue
			: new Date(Number(customer.created_at) * 1000);
	const updatedAt =
		updatedAtValue && !Number.isNaN(updatedAtValue.getTime()) ? updatedAtValue : createdAt;

	return {
		id: customer.id,
		email: typeof payload.email === 'string' ? payload.email : '',
		name: typeof payload.name === 'string' ? payload.name : undefined,
		avatar_url: customer.avatar_url || undefined,
		tags: Array.isArray(payload.tags) ? (payload.tags as Label[]) : [],
		created_at: createdAt,
		updated_at: updatedAt
	} as Customer;
}

async function decryptCustomers(customers: DBCustomer[], masterKey: string): Promise<Customer[]> {
	const decrypted = await Promise.allSettled(
		customers.map(async (customer) => await decryptCustomer(customer, masterKey))
	);

	const failed = decrypted.filter((r) => r.status === 'rejected');
	if (failed.length > 0) {
		console.error(
			`Customer decryption failed on ${failed.length} shards`,
			failed.map((r) => r.reason || 'Unknown')
		);
	}

	return decrypted.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}
/// returns successful results + errors, auto logs errors

export function results<T>(response: (QueryResult<T> | null)[]): [T[], string[]] {
	const nonNull = response.filter((r) => r != null);
	if (nonNull.length === 0) return [[], []];

	const suceeded = nonNull.filter((r) => r.success).flatMap((r) => r.results ?? []);
	const failed = nonNull.filter((r) => !r.success).map((r) => r.error || 'Unknown error');

	if (failed.length > 0) {
		console.warn(`Query failed on ${failed.length} shard(s):`, failed);
	}

	return [suceeded, failed];
}

// #endregion

// user utilities

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
	return exists === '1';
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

// #region Authentication

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
		if (isHttpError(error)) {
			return null;
		}

		throw error;
	}
}

function canViewPrivateTicket(current: User | null, ticket: Ticket): boolean {
	if (!ticket.private) {
		return true;
	}

	if (!current) {
		return false;
	}

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
		user = await firstByLookupKey<DBUser>(
			lookupKey,
			`SELECT ${USER_SELECT_COLUMNS} FROM users WHERE email_lookup = ?`,
			[emailLookupHash]
		);
	} else {
		const username0 = usernameOrEmail.trim();
		user = await firstByLookupKey<DBUser>(
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
}

// #endregion

// #region User CRUD

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
	const existing = await first<{ password_hash: Uint8Array | null }>(
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

export async function patchUser(
	user: User,
	updates: Partial<Omit<User, 'id' | 'created_at' | 'updated_at'>>,
	env: any
): Promise<User> {
	const merged: User = { ...user, ...updates, updated_at: new Date() };
	const encrypted = await encrypt(
		{
			email: merged.email,
			name: merged.name,
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
		'email',
		'name',
		'avatar_url',
		'role',
		'permissions',
		'created_at',
		'updated_at'
	];
	const sortKey = (sortableFields.includes(sort as keyof User) ? sort : 'id') as keyof User;

	return await cache(cacheKey, async () => {
		const sql = search
			? `SELECT ${USER_LIST_COLUMNS} FROM users WHERE username LIKE ?`
			: `SELECT ${USER_LIST_COLUMNS} FROM users`;
		const bindings = search ? [`%${search}%`] : [];

		const result = await allAllShardsGlobal<DBUser>(sql, bindings, {
			sortBy: sort as keyof DBUser,
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
			const user = await first<DBUser>(id, `SELECT ${USER_FETCH_COLUMNS} FROM users WHERE id = ?`, [
				id
			]);

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
			const user = await firstByLookupKey<DBUser>(
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
			const user = await firstByLookupKey<DBUser>(
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

// #region Label CRUD

export async function createLabel(name: string, color?: string): Promise<Label> {
	const maxRow = await first<{ id: number }>(
		'labels',
		`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM labels`,
		[]
	);
	const nextId = Number(maxRow?.id ?? 1);
	const nowSeconds = Math.floor(Date.now() / 1000);

	await run(
		String(nextId),
		`INSERT INTO labels (id, name, color, created_at) VALUES (?, ?, ?, ?)`,
		[nextId, name, color ?? null, nowSeconds]
	);

	const label = await getLabelById(nextId);
	if (!label) {
		throw createError({
			statusCode: 500,
			message: 'Failed to create label'
		});
	}

	return { ...label, color: label.color || undefined };
}

export async function getLabelById(id: number): Promise<Label | null> {
	const label = await first<DBLabel>(
		String(id),
		`SELECT id, name, color FROM labels WHERE id = ?`,
		[id]
	);

	if (!label) {
		return null;
	}

	return { ...label, color: label.color || undefined };
}

export async function listLabels(): Promise<Label[]> {
	const labels = await allAllShardsGlobal<DBLabel>(`SELECT id, name, color FROM labels`, []).then(
		(r) => r.results
	);
	return labels.map((label) => ({ ...label, color: label.color || undefined }));
}

export async function patchLabel(id: number, updates: Partial<Omit<Label, 'id'>>): Promise<Label> {
	const fields = [];
	const bindings = [];
	if (updates.name) {
		fields.push('name = ?');
		bindings.push(updates.name);
	}
	if (updates.color !== undefined) {
		fields.push('color = ?');
		bindings.push(updates.color || null);
	}

	if (fields.length === 0) {
		throw createError({
			statusCode: 400,
			message: 'No valid fields to update'
		});
	}

	bindings.push(id);
	const id0 = String(id);
	await run(id0, `UPDATE labels SET ${fields.join(', ')} WHERE id = ?`, bindings);

	const updated = await first<DBLabel>(id0, `SELECT id, name, color FROM labels WHERE id = ?`, [
		id
	]);

	if (!updated) {
		throw createError({
			statusCode: 404,
			message: 'Label not found after update'
		});
	}

	return { ...updated, color: updated.color || undefined };
}

export async function deleteLabel(id: number): Promise<void> {
	await run(String(id), `DELETE FROM labels WHERE id = ?`, [id]);
}

// #endregion

// #region Ticket CRUD

type TicketEncryptedSection = {
	data: unknown;
	wrapped_dek: unknown;
	nonce: unknown;
	tag: unknown;
	algorithm: unknown;
	version: unknown;
};

type StoredTicketMessage = Omit<
	TicketMessage,
	'sender_id' | 'attachments' | 'created_at' | 'private'
> & {
	created_at: string;
};

type StoredTicketAttachment = {
	id: number;
	ticket_id: number;
	data: string;
	file_name: string;
	mimetype: string;
	created_at: string;
};

function parseCsvStringList(value: unknown): string[] {
	if (value == null || value === '') return [];
	return String(value)
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function parseCsvNumberList(value: unknown): number[] {
	return parseCsvStringList(value)
		.map((entry) => Number(entry))
		.filter((entry) => Number.isFinite(entry));
}

function joinCsvStringList(values?: string[] | null): string | null {
	if (!values || values.length === 0) return null;
	return Array.from(
		new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))
	).join(',');
}

function joinCsvNumberList(values?: number[] | null): string | null {
	if (!values || values.length === 0) return null;
	return Array.from(new Set(values.filter((value) => Number.isFinite(value)))).join(',');
}

function normalizeTicketStatus(value: unknown): TicketStatus {
	if (Object.values(TicketStatus).includes(value as TicketStatus)) {
		return value as TicketStatus;
	}

	throw createError({
		statusCode: 500,
		message: 'Invalid ticket status on ticket record'
	});
}

function normalizeTicketPriority(value: unknown): TicketPriority {
	if (Object.values(TicketPriority).includes(value as TicketPriority)) {
		return value as TicketPriority;
	}

	throw createError({
		statusCode: 500,
		message: 'Invalid ticket priority on ticket record'
	});
}

function toStoredTicketMessage(message: TicketMessage): StoredTicketMessage {
	return {
		id: message.id,
		ticket_id: message.ticket_id,
		reply_to: message.reply_to,
		sender: message.sender,
		message: message.message,
		created_at: message.created_at.toISOString()
	};
}

function fromStoredTicketMessage(
	message: StoredTicketMessage,
	ticket: DBTicket,
	attachments?: TicketAttachment[]
): TicketMessage {
	return {
		id: message.id,
		ticket_id: message.ticket_id,
		reply_to: message.reply_to,
		sender: message.sender,
		sender_id: message.sender.id.toString(),
		private: ticket.private === 1,
		message: message.message,
		created_at: new Date(message.created_at),
		attachments: attachments && attachments.length > 0 ? attachments : undefined
	};
}

function toStoredTicketAttachment(attachment: TicketAttachment): StoredTicketAttachment {
	return {
		id: attachment.id,
		ticket_id: attachment.ticket_id,
		data: attachment.data,
		file_name: attachment.file_name,
		mimetype: attachment.mimetype,
		created_at: attachment.created_at.toISOString()
	};
}

function fromStoredTicketAttachment(attachment: StoredTicketAttachment): TicketAttachment {
	return {
		id: attachment.id,
		ticket_id: attachment.ticket_id,
		data: attachment.data,
		file_name: attachment.file_name,
		mimetype: attachment.mimetype,
		created_at: new Date(attachment.created_at)
	};
}

function ticketSectionBindings(
	encrypted: Awaited<ReturnType<typeof encrypt>> | null
): Array<Uint8Array | string | number | null> {
	if (!encrypted) {
		return [null, null, null, null, null, null];
	}

	return [
		encrypted.ciphertext,
		encrypted.wrapped_dek,
		encrypted.nonce,
		encrypted.tag,
		encrypted.algorithm,
		encrypted.version
	];
}

function hasCompleteEncryptedSection(section: TicketEncryptedSection): boolean {
	const values = [
		section.data,
		section.wrapped_dek,
		section.nonce,
		section.tag,
		section.algorithm,
		section.version
	];

	return values.every((value) => value != null);
}

async function decryptTicketSection<T>(
	section: TicketEncryptedSection,
	masterKey: string
): Promise<T | null> {
	if (!hasCompleteEncryptedSection(section)) {
		const hasAny = Object.values(section).some((value) => value != null);
		if (hasAny) {
			throw createError({
				statusCode: 500,
				message: 'Invalid ticket encryption metadata'
			});
		}

		return null;
	}

	const decrypted = await decrypt(
		{
			data: toUint8Array(section.data, 'ticket_section_data'),
			wrapped_dek: toUint8Array(section.wrapped_dek, 'ticket_section_wrapped_dek'),
			nonce: toUint8Array(section.nonce, 'ticket_section_nonce'),
			tag: toUint8Array(section.tag, 'ticket_section_tag'),
			algorithm: toEncryptionAlgorithm(section.algorithm),
			version: Number(section.version)
		},
		masterKey
	);

	return decrypted as T;
}

async function readTicketSections(
	row: DBTicket,
	masterKey: string
): Promise<{
	messages: (StoredTicketMessage | null)[] | null;
	attachments: (StoredTicketAttachment[] | null)[] | null;
}> {
	const messages = await decryptTicketSection<(StoredTicketMessage | null)[]>(
		{
			data: row.messages_data,
			wrapped_dek: row.messages_wrapped_dek,
			nonce: row.messages_nonce,
			tag: row.messages_tag,
			algorithm: row.messages_algorithm,
			version: row.messages_version
		},
		masterKey
	);

	const attachments = await decryptTicketSection<(StoredTicketAttachment[] | null)[] | null>(
		{
			data: row.attachments_data,
			wrapped_dek: row.attachments_wrapped_dek,
			nonce: row.attachments_nonce,
			tag: row.attachments_tag,
			algorithm: row.attachments_algorithm,
			version: row.attachments_version
		},
		masterKey
	);

	return { messages, attachments };
}

async function writeTicketSections(
	id: number,
	messages: (StoredTicketMessage | null)[] | null,
	attachments: (StoredTicketAttachment[] | null)[] | null,
	env: any
): Promise<void> {
	const messagesEncrypted = messages ? await encrypt(messages, env.MASTER_KEY) : null;
	const attachmentsEncrypted = attachments ? await encrypt(attachments, env.MASTER_KEY) : null;
	const updatedAt = Math.floor(Date.now() / 1000);

	await run(
		id.toString(),
		`UPDATE tickets
		 SET messages_data = ?, messages_wrapped_dek = ?, messages_nonce = ?, messages_tag = ?, messages_algorithm = ?, messages_version = ?,
		     attachments_data = ?, attachments_wrapped_dek = ?, attachments_nonce = ?, attachments_tag = ?, attachments_algorithm = ?, attachments_version = ?,
		     updated_at = ?
		 WHERE id = ?`,
		[
			...ticketSectionBindings(messagesEncrypted),
			...ticketSectionBindings(attachmentsEncrypted),
			updatedAt,
			id
		]
	);

	await invalidateTicketCache(id);
}

async function hydrateTicket(row: DBTicket, env: any): Promise<Ticket> {
	const assigneeIds = parseCsvStringList(row.assignees);
	const assignees = (
		await Promise.all(assigneeIds.map(async (assigneeId) => await getUserById(assigneeId, env)))
	).filter((assignee): assignee is User => assignee !== null);

	return {
		id: row.id,
		title: row.title,
		description: row.description,
		status: normalizeTicketStatus(row.status),
		priority: normalizeTicketPriority(row.priority),
		labels: parseCsvNumberList(row.labels),
		private: row.private === 1,
		customer_id: Number(row.customer_id),
		assignees,
		created_at: new Date(Number(row.created_at) * 1000),
		updated_at: new Date(Number(row.updated_at) * 1000)
	};
}

async function hydrateTicketMessages(row: DBTicket, env: any): Promise<TicketMessage[]> {
	const masterKey = env.MASTER_KEY;
	const sections = await readTicketSections(row, masterKey);
	if (!sections.messages || sections.messages.length === 0) {
		return [];
	}

	const attachments = sections.attachments || [];
	const messages: TicketMessage[] = [];

	for (let index = 0; index < sections.messages.length; index += 1) {
		const storedMessage = sections.messages[index];
		if (!storedMessage) {
			continue;
		}

		const storedAttachments = attachments[index] ?? null;
		const ticketAttachments = storedAttachments
			? storedAttachments.map(fromStoredTicketAttachment)
			: undefined;
		messages.push(fromStoredTicketMessage(storedMessage, row, ticketAttachments));
	}

	return messages;
}

async function hydrateTicketThread(row: DBTicket, env: any): Promise<TicketThread> {
	const ticket = await hydrateTicket(row, env);
	const messages = await hydrateTicketMessages(row, env);
	const participants = new Map<string, User | TicketActor>();

	for (const assignee of ticket.assignees) {
		participants.set(`user:${assignee.id}`, assignee);
	}

	for (const message of messages) {
		if (message.sender.kind === 'user') {
			const fullUser = await getUserById(message.sender.id, env);
			participants.set(`user:${message.sender.id}`, fullUser ?? message.sender);
		} else {
			participants.set(`customer:${message.sender.id}`, message.sender);
		}
	}

	return {
		ticket,
		messages,
		users: Array.from(participants.values())
	};
}

function toTicketAttachmentInput(
	attachment: TicketAttachmentInput,
	ticketId: number,
	attachmentId: number
): TicketAttachment {
	return {
		id: attachmentId,
		ticket_id: ticketId,
		data: attachment.data,
		file_name: attachment.file_name,
		mimetype: attachment.mimetype,
		created_at: new Date()
	};
}

async function getTicketRowById(id: number): Promise<DBTicket | null> {
	return await first<DBTicket>(id.toString(), `SELECT * FROM tickets WHERE id = ?`, [id]);
}

export async function createTicket(input: TicketCreateInput, env: any): Promise<Ticket> {
	ensureCollegeDB(env);
	const maxRow = await first<{ id: number }>(
		'tickets',
		`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM tickets`,
		[]
	);
	const nextId = Number(maxRow?.id ?? 1);
	const nowSeconds = Math.floor(Date.now() / 1000);

	const labels = joinCsvNumberList(input.labels);
	const assignees = joinCsvStringList(input.assignee_ids);
	await run(
		String(nextId),
		`INSERT INTO tickets (
			id, title, created_at, updated_at, description, customer_id, status, priority, labels, assignees, private
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			nextId,
			input.title,
			nowSeconds,
			nowSeconds,
			input.description,
			input.customer_id,
			input.status ?? TicketStatus.Open,
			input.priority ?? TicketPriority.None,
			labels,
			assignees,
			input.private ? 1 : 0
		]
	);

	const createdRow = await getTicketRowById(nextId);
	if (!createdRow) {
		throw createError({
			statusCode: 500,
			message: 'Failed to retrieve created ticket'
		});
	}

	return await hydrateTicket(createdRow, env);
}

export async function patchTicket(
	id: number,
	updates: TicketPatchInput,
	env: any
): Promise<Ticket> {
	ensureCollegeDB(env);

	const fields: string[] = [];
	const bindings: Array<string | number | null> = [];

	if (updates.title !== undefined) {
		fields.push('title = ?');
		bindings.push(updates.title);
	}

	if (updates.description !== undefined) {
		fields.push('description = ?');
		bindings.push(updates.description);
	}

	if (updates.customer_id !== undefined) {
		fields.push('customer_id = ?');
		bindings.push(updates.customer_id);
	}

	if (updates.status !== undefined) {
		fields.push('status = ?');
		bindings.push(updates.status);
	}

	if (updates.priority !== undefined) {
		fields.push('priority = ?');
		bindings.push(updates.priority);
	}

	if (updates.labels !== undefined) {
		fields.push('labels = ?');
		bindings.push(joinCsvNumberList(updates.labels));
	}

	if (updates.assignee_ids !== undefined) {
		fields.push('assignees = ?');
		bindings.push(joinCsvStringList(updates.assignee_ids));
	}

	if (updates.private !== undefined) {
		fields.push('private = ?');
		bindings.push(updates.private ? 1 : 0);
	}

	if (fields.length === 0) {
		throw createError({
			statusCode: 400,
			message: 'No valid fields to update'
		});
	}

	const updatedAt = Math.floor(Date.now() / 1000);

	await run(id.toString(), `UPDATE tickets SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`, [
		...bindings,
		updatedAt,
		id
	]);

	const updatedRow = await getTicketRowById(id);
	if (!updatedRow) {
		throw createError({
			statusCode: 500,
			message: 'Failed to retrieve updated ticket'
		});
	}

	await invalidateTicketCache(id);
	return await hydrateTicket(updatedRow, env);
}

export async function deleteTicket(id: number, env: any): Promise<void> {
	ensureCollegeDB(env);
	await run(id.toString(), `DELETE FROM tickets WHERE id = ?`, [id]);
	await invalidateTicketCache(id);
}

export async function listTickets(
	env: any,
	search: string,
	page: number,
	limit: number,
	offset: number,
	sort: keyof DBTicket,
	sort_direction: 'asc' | 'desc',
	current: User | null = null
): Promise<Ticket[]> {
	ensureCollegeDB(env);

	const cacheKey = `smoke:cache:tickets:${search}:${page}:${limit}:${sort}:${sort_direction}`;
	return await cache(cacheKey, async () => {
		const bindings: Array<string | number> = [];
		const clauses: string[] = [];

		if (search) {
			clauses.push('(title LIKE ? OR description LIKE ?)');
			bindings.push(`%${search}%`, `%${search}%`);
		}

		if (!current) {
			clauses.push('private = 0');
		} else if (!current.permissions.includes(Permission.ViewPrivateTickets)) {
			clauses.push('(private = 0 OR assignees LIKE ?)');
			bindings.push(`%${current.id}%`);
		}

		const sql = `SELECT * FROM tickets${clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''}`;

		const result = await allAllShardsGlobal<DBTicket>(sql, bindings, {
			sortBy: sort as keyof DBTicket,
			sortDirection: sort_direction as 'asc' | 'desc',
			offset,
			limit
		});

		return await Promise.all(
			result.results.map(async (ticket) => await hydrateTicket(ticket, env))
		);
	});
}

export async function getTicketById(
	id: number,
	env: any,
	current: User | null = null
): Promise<Ticket | null> {
	ensureCollegeDB(env);
	// Cache the hydrated ticket independent of the calling user; the visibility
	// filter is applied per-caller below so the cache stays user-agnostic.
	const hydrated = await cache(
		`smoke:cache:ticket_id:${id}`,
		async () => {
			const row = await getTicketRowById(id);
			if (!row) return null;
			return await hydrateTicket(row, env);
		},
		300
	);
	if (!hydrated) return null;
	if (!canViewPrivateTicket(current, hydrated)) return null;
	return hydrated;
}

async function invalidateTicketCache(id: number): Promise<void> {
	await kv.del(`smoke:cache:ticket_id:${id}`);
}

export async function getTicketsByPriority(priority: TicketPriority, env: any): Promise<Ticket[]> {
	ensureCollegeDB(env);
	const result = await allAllShardsGlobal<DBTicket>(
		`SELECT * FROM tickets WHERE priority = ? ORDER BY created_at DESC`,
		[priority]
	);
	return await Promise.all(result.results.map(async (ticket) => await hydrateTicket(ticket, env)));
}

export async function addTicketMessage(
	ticketId: number,
	input: TicketMessageInput,
	env: any
): Promise<TicketMessage> {
	ensureCollegeDB(env);

	const ticket = await getTicketRowById(ticketId);
	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found'
		});
	}

	const sections = await readTicketSections(ticket, env.MASTER_KEY);
	const messages = sections.messages ? [...sections.messages] : [];
	const attachments = sections.attachments
		? [...sections.attachments]
		: Array.from(
				{
					length: messages.length
				},
				() => null
			);
	const messageId = messages.length;

	let sender = input.sender;
	if (sender.kind === 'user') {
		const hydratedUser = await getUserById(sender.id, env);
		if (hydratedUser) {
			sender = {
				kind: 'user',
				id: hydratedUser.id,
				username: hydratedUser.username,
				email: hydratedUser.email,
				name: hydratedUser.name,
				avatar_url: hydratedUser.avatar_url
			};
		}
	}

	const attachmentEntries = (input.attachments || []).map((attachment, index) =>
		toTicketAttachmentInput(attachment, ticketId, index)
	);

	const ticketMessage: TicketMessage = {
		id: messageId,
		ticket_id: ticketId,
		reply_to: input.reply_to,
		sender,
		sender_id: sender.id.toString(),
		private: ticket.private === 1,
		message: input.message,
		created_at: new Date(),
		attachments: attachmentEntries.length > 0 ? attachmentEntries : undefined
	};

	messages.push(toStoredTicketMessage(ticketMessage));
	attachments.push(
		attachmentEntries.length > 0 ? attachmentEntries.map(toStoredTicketAttachment) : null
	);

	await writeTicketSections(ticketId, messages, attachments, env);

	return ticketMessage;
}

export async function getTicketThread(
	id: number,
	env: any,
	current: User | null = null
): Promise<TicketThread> {
	ensureCollegeDB(env);

	const ticket = await getTicketRowById(id);
	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found'
		});
	}

	const thread = await hydrateTicketThread(ticket, env);
	if (!canViewPrivateTicket(current, thread.ticket)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to view this ticket'
		});
	}

	return thread;
}

export async function listTicketMessages(
	id: number,
	env: any,
	search: string,
	sort: keyof Omit<TicketMessage, 'attachments' | 'ticket_id' | 'sender'>,
	sort_direction: 'asc' | 'desc',
	current: User | null = null
): Promise<TicketMessage[]> {
	const thread = await getTicketThread(id, env, current);
	return thread.messages
		.filter((message) => {
			if (!search) return true;
			const lowerSearch = search.toLowerCase();
			return (
				message.message.toLowerCase().includes(lowerSearch) ||
				(message.sender.kind === 'user' &&
					(message.sender.username.toLowerCase().includes(lowerSearch) ||
						message.sender.email?.toLowerCase().includes(lowerSearch) ||
						(message.sender.name && message.sender.name.toLowerCase().includes(lowerSearch))))
			);
		})
		.sort((a, b) => {
			const fieldA = (a[sort]?.toString() || '').toLowerCase();
			const fieldB = (b[sort]?.toString() || '').toLowerCase();
			if (fieldA < fieldB) return sort_direction === 'asc' ? -1 : 1;
			if (fieldA > fieldB) return sort_direction === 'asc' ? 1 : -1;

			return 0;
		});
}

export async function getTicketMessage(
	ticketId: number,
	messageId: number,
	env: any,
	current: User | null = null
): Promise<TicketMessage> {
	const thread = await getTicketThread(ticketId, env, current);
	const message = thread.messages.find((msg) => msg.id === messageId);
	if (!message) {
		throw createError({
			statusCode: 404,
			message: 'Ticket message not found'
		});
	}

	return message;
}

export async function editTicketMessage(
	ticketId: number,
	messageId: number,
	content: string,
	attachments: TicketAttachmentInput[] | undefined,
	env: any
): Promise<TicketMessage> {
	ensureCollegeDB(env);

	const ticket = await getTicketRowById(ticketId);
	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found'
		});
	}

	const sections = await readTicketSections(ticket, env.MASTER_KEY);
	const messages = sections.messages ? [...sections.messages] : [];
	if (messageId < 0 || messageId >= messages.length || !messages[messageId]) {
		throw createError({
			statusCode: 404,
			message: 'Ticket message not found'
		});
	}

	const oldAttachments = sections.attachments
		? [...sections.attachments]
		: Array.from(
				{
					length: messages.length
				},
				() => null
			);

	const storedMessage = messages[messageId]!;
	const storedAttachments = oldAttachments[messageId] ?? null;

	const ticketAttachments = attachments
		? attachments.map((attachment, index) =>
				toTicketAttachmentInput(attachment, ticketId, messageId * 1000 + index)
			)
		: storedAttachments
			? storedAttachments.map(fromStoredTicketAttachment)
			: undefined;

	const updatedMessage: TicketMessage = {
		id: storedMessage.id,
		ticket_id: storedMessage.ticket_id,
		reply_to: storedMessage.reply_to,
		sender: storedMessage.sender,
		sender_id: storedMessage.sender.id.toString(),
		private: ticket.private === 1,
		message: content,
		created_at: new Date(storedMessage.created_at),
		attachments: ticketAttachments
	};

	messages[messageId] = toStoredTicketMessage(updatedMessage);
	oldAttachments[messageId] = ticketAttachments
		? ticketAttachments.map(toStoredTicketAttachment)
		: null;

	await writeTicketSections(ticketId, messages, oldAttachments, env);

	return updatedMessage;
}

export async function deleteTicketMessage(
	ticketId: number,
	messageId: number,
	env: any
): Promise<void> {
	ensureCollegeDB(env);

	const ticket = await getTicketRowById(ticketId);
	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found'
		});
	}

	const sections = await readTicketSections(ticket, env.MASTER_KEY);
	const messages = sections.messages ? [...sections.messages] : [];
	if (messageId < 0 || messageId >= messages.length || !messages[messageId]) {
		throw createError({
			statusCode: 404,
			message: 'Ticket message not found'
		});
	}

	const attachments = sections.attachments
		? [...sections.attachments]
		: Array.from(
				{
					length: messages.length
				},
				() => null
			);
	messages[messageId] = null;
	attachments[messageId] = null;

	if (messages.every((entry) => entry == null)) {
		await writeTicketSections(ticketId, null, null, env);
		return;
	}

	await writeTicketSections(ticketId, messages, attachments, env);
}

export async function clearTicketMessages(id: number, env: any): Promise<void> {
	ensureCollegeDB(env);

	const ticket = await getTicketRowById(id);
	if (!ticket) {
		throw createError({
			statusCode: 404,
			message: 'Ticket not found'
		});
	}

	await writeTicketSections(id, null, null, env);
}

// #endregion

// #region Customer CRUD

async function getCustomerRowById(id: number): Promise<DBCustomer | null> {
	return await first<DBCustomer>(id.toString(), `SELECT * FROM customers WHERE id = ?`, [id]);
}

type CustomerCreateInput = {
	name: string;
	email: string;
	avatar_url?: string;
	tags?: Label[];
};

async function getCustomerEmailHash(email: string, env: any): Promise<string> {
	return await hmacSha256(env.HMAC_SECRET, email.trim().toLowerCase());
}

async function setCustomerEmailLookup(email: string, customerId: number, env: any): Promise<void> {
	const lookupHash = await getCustomerEmailHash(email, env);
	await kv.set(`${CUSTOMER_EMAIL_LOOKUP_PREFIX}${lookupHash}`, String(customerId));
}

async function deleteCustomerEmailLookup(email: string, env: any): Promise<void> {
	const lookupHash = await getCustomerEmailHash(email, env);
	await kv.del(`${CUSTOMER_EMAIL_LOOKUP_PREFIX}${lookupHash}`);
}

export async function createCustomer(input: CustomerCreateInput, env: any): Promise<Customer> {
	ensureCollegeDB(env);
	const maxRow = await first<{ id: number }>(
		'customers',
		`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM customers`,
		[]
	);
	const nextId = Number(maxRow?.id ?? 1);
	const nowSeconds = Math.floor(Date.now() / 1000);
	const nowIso = new Date(nowSeconds * 1000).toISOString();

	const payload = {
		name: input.name,
		email: input.email,
		tags: input.tags || [],
		created_at: nowIso,
		updated_at: nowIso
	};

	const encrypted = await encrypt(payload, env.MASTER_KEY);
	await run(
		String(nextId),
		`INSERT INTO customers (id, avatar_url, created_at, data, wrapped_dek, nonce, tag, algorithm, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			nextId,
			input.avatar_url || null,
			nowSeconds,
			encrypted.ciphertext,
			encrypted.wrapped_dek,
			encrypted.nonce,
			encrypted.tag,
			encrypted.algorithm,
			encrypted.version
		]
	);

	const createdRow = await getCustomerRowById(nextId);
	if (!createdRow) {
		throw createError({
			statusCode: 500,
			message: 'Failed to retrieve created customer'
		});
	}

	await setCustomerEmailLookup(input.email, nextId, env);

	return await decryptCustomer(createdRow, env.MASTER_KEY);
}

export async function patchCustomer(
	id: number,
	updates: Partial<Omit<Customer, 'id'>>,
	env: any
): Promise<Customer> {
	ensureCollegeDB(env);

	const customerRow = await getCustomerRowById(id);
	if (!customerRow) {
		throw createError({
			statusCode: 404,
			message: 'Customer not found'
		});
	}

	const existing = await decryptCustomer(customerRow, env.MASTER_KEY);
	const payload = {
		name: updates.name ?? existing.name,
		email: updates.email ?? existing.email,
		tags: updates.tags ?? existing.tags,
		created_at: existing.created_at.toISOString(),
		updated_at: new Date().toISOString()
	};

	const encrypted = await encrypt(payload, env.MASTER_KEY);
	const nextAvatarUrl =
		updates.avatar_url !== undefined ? updates.avatar_url : existing.avatar_url || null;
	if (updates.email && updates.email !== existing.email) {
		await deleteCustomerEmailLookup(existing.email, env);
		await setCustomerEmailLookup(updates.email, id, env);
	}

	await run(
		id.toString(),
		`UPDATE customers SET avatar_url = ?, data = ?, wrapped_dek = ?, nonce = ?, tag = ?, algorithm = ?, version = ? WHERE id = ?`,
		[
			nextAvatarUrl,
			encrypted.ciphertext,
			encrypted.wrapped_dek,
			encrypted.nonce,
			encrypted.tag,
			encrypted.algorithm,
			encrypted.version,
			id
		]
	);

	const updatedRow = await getCustomerRowById(id);
	if (!updatedRow) {
		throw createError({
			statusCode: 500,
			message: 'Failed to retrieve updated customer'
		});
	}

	await kv.del(`smoke:cache:customer_id:${id}`);
	return await decryptCustomer(updatedRow, env.MASTER_KEY);
}

export async function deleteCustomer(id: number, env: any): Promise<void> {
	ensureCollegeDB(env);
	const existing = await getCustomerRowById(id);
	if (existing) {
		const decrypted = await decryptCustomer(existing, env.MASTER_KEY);
		await deleteCustomerEmailLookup(decrypted.email, env);
	}
	await run(id.toString(), `DELETE FROM customers WHERE id = ?`, [id]);
	await kv.del(`smoke:cache:customer_id:${id}`);
}

export async function listCustomers(
	env: any,
	search: string,
	page: number,
	limit: number,
	offset: number,
	_sort: string,
	sort_direction: 'asc' | 'desc'
): Promise<Customer[]> {
	const masterKey = env.MASTER_KEY;
	const cacheKey = `smoke:cache:customer:list:${search}:${page}:${limit}:created_at:${sort_direction}`;

	return await cache(cacheKey, async () => {
		const result = await allAllShardsGlobal<DBCustomer>('SELECT * FROM customers', []);
		const customers = await decryptCustomers(result.results, masterKey);
		const normalizedSearch = search.trim().toLowerCase();
		const filtered = normalizedSearch
			? customers.filter(
					(customer) =>
						customer.name?.toLowerCase().includes(normalizedSearch) ||
						customer.email.toLowerCase().includes(normalizedSearch)
				)
			: customers;

		const sorted = [...filtered].sort((a, b) => {
			const fieldA = a.created_at.getTime();
			const fieldB = b.created_at.getTime();

			if (fieldA < fieldB) return sort_direction === 'asc' ? -1 : 1;
			if (fieldA > fieldB) return sort_direction === 'asc' ? 1 : -1;
			return 0;
		});

		return sorted.slice(offset, offset + limit);
	});
}

export async function getCustomerById(id: number, env: any): Promise<Customer | null> {
	ensureCollegeDB(env);
	return await cache(
		`smoke:cache:customer_id:${id}`,
		async () => {
			const customer = await getCustomerRowById(id);
			if (!customer) return null;
			return await decryptCustomer(customer, env.MASTER_KEY);
		},
		3600
	);
}

export async function getCustomerByEmail(email: string, env: any): Promise<Customer | null> {
	ensureCollegeDB(env);
	const lookupHash = await getCustomerEmailHash(email, env);
	const customerId = await kv.get<string>(`${CUSTOMER_EMAIL_LOOKUP_PREFIX}${lookupHash}`);
	if (customerId) {
		const found = await getCustomerById(Number(customerId), env);
		if (found) return found;
	}

	const allRows = await allAllShardsGlobal<any>('SELECT * FROM customers', []);
	const allCustomers = await decryptCustomers(allRows.results as DBCustomer[], env.MASTER_KEY);
	const normalized = email.trim().toLowerCase();
	const match = allCustomers.find((customer) => customer.email.trim().toLowerCase() === normalized);
	if (match) {
		await setCustomerEmailLookup(match.email, match.id, env);
	}

	return match ?? null;
}
