import { allAllShardsGlobal, first, run } from '@earth-app/collegedb';
import { DBCustomer, ensureCollegeDB } from 'hub:db:schema';

const CUSTOMER_EMAIL_LOOKUP_PREFIX = 'smoke:customer_email_hash:';

// #region encryption

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

// #endregion

// #region crud

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

// #endregion
