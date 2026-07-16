import { afterEach, describe, expect, it } from 'vitest';
import {
	decrypt,
	encrypt,
	getPbkdf2Iterations,
	setPbkdf2Iterations
} from '~/server/utils/encryption';

const MASTER_KEY = 'm'.repeat(32);

async function roundTrip(data: object): Promise<unknown> {
	const enc = await encrypt(data, MASTER_KEY);
	return decrypt(
		{
			wrapped_dek: enc.wrapped_dek,
			nonce: enc.nonce,
			tag: enc.tag,
			data: enc.ciphertext,
			algorithm: enc.algorithm,
			version: enc.version
		},
		MASTER_KEY
	);
}

describe('envelope encryption pbkdf2 iterations', () => {
	afterEach(() => {
		// restore the workers-safe default so a custom count never leaks into another spec
		setPbkdf2Iterations(100000);
	});

	it('round-trips at the default iteration count', async () => {
		setPbkdf2Iterations(100000);
		expect(await roundTrip({ hello: 'world' })).toEqual({ hello: 'world' });
	});

	it('round-trips at a custom configured count', async () => {
		setPbkdf2Iterations(25000);
		expect(getPbkdf2Iterations()).toBe(25000);
		expect(await roundTrip({ a: 1, b: [2, 3] })).toEqual({ a: 1, b: [2, 3] });
	});

	// the count is stored inline per wrapped-dek, so changing the active count later (a config change
	// or a different isolate) must not orphan already-encrypted rows
	it('decrypts data wrapped at a different count than the current active count', async () => {
		setPbkdf2Iterations(20000);
		const enc = await encrypt({ secret: 42 }, MASTER_KEY);
		setPbkdf2Iterations(90000);
		const out = await decrypt(
			{
				wrapped_dek: enc.wrapped_dek,
				nonce: enc.nonce,
				tag: enc.tag,
				data: enc.ciphertext,
				algorithm: enc.algorithm,
				version: enc.version
			},
			MASTER_KEY
		);
		expect(out).toEqual({ secret: 42 });
	});

	it('clamps out-of-range counts to the workers-safe window', () => {
		setPbkdf2Iterations(10_000_000);
		expect(getPbkdf2Iterations()).toBe(100000);
		setPbkdf2Iterations(1);
		expect(getPbkdf2Iterations()).toBe(1000);
	});
});
