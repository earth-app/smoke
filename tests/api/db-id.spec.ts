import { describe, expect, it, vi } from 'vitest';
import { insertWithNextId } from '~/server/utils/db-id';

const uniqueErr = () => new Error('UNIQUE constraint failed: customers.id');

describe('insertWithNextId', () => {
	it('inserts on the first try and returns the id', async () => {
		const read = vi.fn(async () => 5);
		const insert = vi.fn(async () => {});
		const id = await insertWithNextId(read, insert);
		expect(id).toBe(5);
		expect(read).toHaveBeenCalledTimes(1);
		expect(insert).toHaveBeenCalledTimes(1);
		expect(insert).toHaveBeenCalledWith(5);
	});

	it('retries with a fresh id on a unique-id collision', async () => {
		const read = vi.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(6);
		const insert = vi.fn().mockRejectedValueOnce(uniqueErr()).mockResolvedValueOnce(undefined);
		const id = await insertWithNextId(read, insert);
		expect(id).toBe(6);
		expect(read).toHaveBeenCalledTimes(2);
		expect(insert).toHaveBeenCalledTimes(2);
	});

	it('rethrows a non-unique error immediately without retrying', async () => {
		const read = vi.fn(async () => 5);
		const insert = vi.fn(async () => {
			throw new Error('disk full');
		});
		await expect(insertWithNextId(read, insert)).rejects.toThrow('disk full');
		expect(insert).toHaveBeenCalledTimes(1);
	});

	it('gives up after the attempt budget on persistent collisions', async () => {
		const read = vi.fn(async () => 5);
		const insert = vi.fn(async () => {
			throw uniqueErr();
		});
		await expect(insertWithNextId(read, insert, 3)).rejects.toThrow(/UNIQUE/);
		expect(insert).toHaveBeenCalledTimes(3);
	});
});
