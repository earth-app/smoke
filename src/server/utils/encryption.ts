import type { QueryResult } from '@earth-app/collegedb';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import bcrypt from 'bcryptjs';

export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

const ENCRYPTION_VERSION = 1;
const WRAPPED_DEK_VERSION = 1;
const AES_GCM_KEY_BYTES = 32;

const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const WRAP_SALT_BYTES = 16;

const PASSWORD_SALT_BYTES = 16;
const BCRYPT_ROUNDS = 12;

export type PasswordAlgorithm = 'bcrypt' | 'argon2id' | 'scrypt';
export type EncryptionAlgorithm = PasswordAlgorithm | 'aes-256-gcm';

export function toUint8Array(value: unknown, field: string): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	// d1 returns blob columns as a plain number[] of byte values
	if (Array.isArray(value)) return Uint8Array.from(value as number[]);

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

export function randomBytes(length: number): Uint8Array {
	const out = new Uint8Array(length);
	crypto.getRandomValues(out);
	return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const size = parts.reduce((sum, current) => sum + current.length, 0);
	const out = new Uint8Array(size);

	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}

	return out;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;

	let diff = 0;
	for (let i = 0; i < a.length; i += 1) {
		diff |= a[i]! ^ b[i]!;
	}

	return diff === 0;
}

export function toBufferSource(bytes: Uint8Array): ArrayBuffer {
	if (
		bytes.buffer instanceof ArrayBuffer &&
		bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength
	) {
		return bytes.buffer;
	}

	return bytes.slice().buffer as ArrayBuffer;
}

export function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i]!);
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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

export async function hmacSha256(secret: string, input: string): Promise<string> {
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
