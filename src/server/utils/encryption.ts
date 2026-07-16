import type { QueryResult } from '@earth-app/collegedb';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import bcrypt from 'bcryptjs';

export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

const ENCRYPTION_VERSION = 1;
// v2 stores the pbkdf2 iteration count inline (configurable at setup); v1 (legacy) had it fixed and
// is still decryptable via the fallback in unwrapKey
const WRAPPED_DEK_VERSION = 2;
const AES_GCM_KEY_BYTES = 32;

const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const WRAP_SALT_BYTES = 16;

// cloudflare workers cap pbkdf2 at 100k iterations (deriveBits throws above it). the kek input is
// the high-entropy MASTER_KEY (not a user password), so 100k is ample cryptographically; higher
// counts only ever mattered for low-entropy inputs. was 210k, which threw on the workers runtime
const PBKDF2_ITERATIONS = 100_000;
// pre-cap builds (and self-hosted node) wrapped deks at 210k; retried on unwrap so those rows still
// decrypt. a no-op on workers, where 210k always threw and no such row could have been written
const PBKDF2_LEGACY_ITERATIONS = 210_000;
// highest count the workers runtime accepts; the setup field is clamped to this
export const PBKDF2_MAX_ITERATIONS = 100_000;
export const PBKDF2_MIN_ITERATIONS = 1_000;

// active count for NEW wraps; set from the security setting (configurable at setup). stored inline
// per wrapped dek (v2) so a later change never orphans existing rows
let activePbkdf2Iterations = PBKDF2_ITERATIONS;

export function setPbkdf2Iterations(iterations: number): void {
	if (!Number.isFinite(iterations)) return;
	const floored = Math.floor(iterations);
	activePbkdf2Iterations = Math.min(
		PBKDF2_MAX_ITERATIONS,
		Math.max(PBKDF2_MIN_ITERATIONS, floored)
	);
}

export function getPbkdf2Iterations(): number {
	return activePbkdf2Iterations;
}

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

// 4-byte big-endian uint helpers for the inline pbkdf2 iteration count in a v2 wrapped dek
function u32ToBytes(value: number): Uint8Array {
	const v = value >>> 0;
	return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

function bytesToU32(bytes: Uint8Array, offset: number): number {
	return (
		((bytes[offset]! << 24) |
			(bytes[offset + 1]! << 16) |
			(bytes[offset + 2]! << 8) |
			bytes[offset + 3]!) >>>
		0
	);
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

async function derivePBKDF2Key(
	masterKey: string,
	salt: Uint8Array,
	iterations: number = activePbkdf2Iterations
): Promise<Uint8Array> {
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
			iterations
		},
		keyMaterial,
		AES_GCM_KEY_BYTES * 8
	);

	return new Uint8Array(bits);
}

async function deriveWrapKey(
	masterKey: string,
	algorithm: EncryptionAlgorithm,
	salt: Uint8Array,
	iterations: number = activePbkdf2Iterations
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
	// iterations only apply to the pbkdf2 path (argon2/scrypt carry their own work factors above)
	return derivePBKDF2Key(masterKey, salt, iterations);
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
	const iterations = activePbkdf2Iterations;
	const wrapSalt = randomBytes(WRAP_SALT_BYTES);
	const wrapNonce = randomBytes(AES_GCM_NONCE_BYTES);
	const wrapAad = textEncoder.encode(`smoke:dek:v${WRAPPED_DEK_VERSION}:${algorithm}`);

	const wrapKeyBytes = await deriveWrapKey(masterKey, algorithm, wrapSalt, iterations);
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

	// v2 layout: [version][iterations:4 BE][salt][nonce][wrappedDek]
	return concatBytes(
		new Uint8Array([WRAPPED_DEK_VERSION]),
		u32ToBytes(iterations),
		wrapSalt,
		wrapNonce,
		wrappedDek
	);
}

async function decryptWrappedDek(
	masterKey: string,
	algorithm: EncryptionAlgorithm,
	iterations: number,
	wrapSalt: Uint8Array,
	wrapNonce: Uint8Array,
	wrapAad: Uint8Array,
	encryptedDek: Uint8Array
): Promise<Uint8Array> {
	const wrapKeyBytes = await deriveWrapKey(masterKey, algorithm, wrapSalt, iterations);
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

async function unwrapKey(
	wrappedDek: Uint8Array,
	masterKey: string,
	algorithm: EncryptionAlgorithm
): Promise<Uint8Array> {
	if (wrappedDek.length < 1) throw new Error('Invalid wrapped DEK payload');
	const version = wrappedDek[0]!;

	// v2: the pbkdf2 iteration count is stored inline, so decryption is exact for any configured value
	if (version === 2) {
		const minLen = 1 + 4 + WRAP_SALT_BYTES + AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES;
		if (wrappedDek.length < minLen) throw new Error('Invalid wrapped DEK payload');
		const iterations = bytesToU32(wrappedDek, 1);
		const saltStart = 5;
		const saltEnd = saltStart + WRAP_SALT_BYTES;
		const nonceEnd = saltEnd + AES_GCM_NONCE_BYTES;
		const wrapAad = textEncoder.encode(`smoke:dek:v2:${algorithm}`);
		return decryptWrappedDek(
			masterKey,
			algorithm,
			iterations,
			wrappedDek.slice(saltStart, saltEnd),
			wrappedDek.slice(saltEnd, nonceEnd),
			wrapAad,
			wrappedDek.slice(nonceEnd)
		);
	}

	// v1 (legacy): the count was fixed and not stored. try the workers-safe default, then the pre-cap
	// 210k, so rows wrapped by an older/self-hosted node build still decrypt (pbkdf2 path only)
	if (version === 1) {
		const minLen = 1 + WRAP_SALT_BYTES + AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES;
		if (wrappedDek.length < minLen) throw new Error('Invalid wrapped DEK payload');
		const saltStart = 1;
		const saltEnd = saltStart + WRAP_SALT_BYTES;
		const nonceEnd = saltEnd + AES_GCM_NONCE_BYTES;
		const wrapSalt = wrappedDek.slice(saltStart, saltEnd);
		const wrapNonce = wrappedDek.slice(saltEnd, nonceEnd);
		const encryptedDek = wrappedDek.slice(nonceEnd);
		const wrapAad = textEncoder.encode(`smoke:dek:v1:${algorithm}`);
		try {
			return await decryptWrappedDek(
				masterKey,
				algorithm,
				PBKDF2_ITERATIONS,
				wrapSalt,
				wrapNonce,
				wrapAad,
				encryptedDek
			);
		} catch (error) {
			if (algorithm === 'argon2id' || algorithm === 'scrypt') throw error;
			return decryptWrappedDek(
				masterKey,
				algorithm,
				PBKDF2_LEGACY_ITERATIONS,
				wrapSalt,
				wrapNonce,
				wrapAad,
				encryptedDek
			);
		}
	}

	throw new Error(`Unsupported wrapped DEK version: ${version}`);
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
