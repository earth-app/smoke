import {
	createInMemoryKVProvider,
	createInMemorySQLProvider,
	type InMemoryKVStorage,
	type InMemorySQLDatabase
} from '@earth-app/collegedb';
import { afterEach, beforeEach, vi } from 'vitest';
import { TicketPriority, TicketStatus } from '~/shared/types/ticket';
import { Permission, Role, type Label } from '~/shared/types/user';
// registers server/utils exports on globalThis so route handlers (which no longer
// import them — nitro auto-imports at runtime) resolve in the test harness
import '#server-utils';

export const TEST_ENV = {
	MASTER_KEY: 'm'.repeat(32),
	HMAC_SECRET: 'h'.repeat(32),
	CF_API_TOKEN: 'cf-api-token',
	SUPPORT_EMAIL: 'support@smoke.example.com',
	NUXT_PUBLIC_SITE_URL: 'https://smoke.example.com',
	// mock-cloudflare toggle (off by default); some specs override to '1'
	MOCK_CF: '',
	// primary db binding; ensureCollegeDB/ensureSchema read env.DB (resolved lazily to the run's db)
	get DB() {
		return runtime?.db;
	}
};

export const MANAGER_PERMISSIONS: Permission[] = [
	Permission.ReplyTicket,
	Permission.CreateTicket,
	Permission.ManageTicket,
	Permission.OpenTicket,
	Permission.CloseTicket,
	Permission.ChangeLabels,
	Permission.ManageLabels,
	Permission.ManageTicketMessages,
	Permission.LinkIssue,
	Permission.AddEmail,
	Permission.RemoveEmail,
	Permission.ChangeCustomerName,
	Permission.ChangeCustomerTags,
	Permission.ManageSelf,
	Permission.ManageUsers,
	Permission.ChangeUserLabels,
	Permission.TogglePrivate,
	Permission.ChangeAvatar,
	Permission.ManageCustomers,
	Permission.ViewAuditLog
];

export const TABLES_SQL = [
	`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		password_hash BLOB,
		password_salt BLOB,
		password_algorithm TEXT,
		data BLOB NOT NULL,
		email_lookup TEXT NOT NULL,
		wrapped_dek BLOB NOT NULL,
		nonce BLOB NOT NULL,
		tag BLOB NOT NULL,
		algorithm TEXT NOT NULL,
		version INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS customers (
		id INTEGER PRIMARY KEY,
		avatar_url TEXT,
		created_at INTEGER NOT NULL,
		data BLOB NOT NULL,
		wrapped_dek BLOB NOT NULL,
		nonce BLOB NOT NULL,
		tag BLOB NOT NULL,
		algorithm TEXT NOT NULL,
		version INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS labels (
		id INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		color TEXT,
		created_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS tickets (
		id INTEGER PRIMARY KEY,
		title TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		description TEXT NOT NULL,
		customer_id INTEGER NOT NULL,
		status TEXT NOT NULL,
		priority TEXT NOT NULL,
		labels TEXT,
		assignees TEXT,
		private INTEGER NOT NULL,
		messages_data BLOB,
		messages_wrapped_dek BLOB,
		messages_nonce BLOB,
		messages_tag BLOB,
		messages_algorithm TEXT,
		messages_version INTEGER,
		attachments_data BLOB,
		attachments_wrapped_dek BLOB,
		attachments_nonce BLOB,
		attachments_tag BLOB,
		attachments_algorithm TEXT,
		attachments_version INTEGER,
		history_data BLOB,
		history_wrapped_dek BLOB,
		history_nonce BLOB,
		history_tag BLOB,
		history_algorithm TEXT,
		history_version INTEGER
	)`,
	`CREATE TABLE IF NOT EXISTS audit_log (
		id INTEGER PRIMARY KEY,
		created_at INTEGER NOT NULL,
		action TEXT NOT NULL,
		actor_id TEXT,
		actor_name TEXT,
		target_type TEXT,
		target_id TEXT,
		ticket_id INTEGER,
		priority TEXT,
		summary TEXT,
		context TEXT
	)`
];

export type NuxtHubKvAdapter = {
	get<T = unknown>(key: string, type?: 'text' | 'json'): Promise<T | null>;
	set(key: string, value: unknown, options?: { ttl?: number }): Promise<void>;
	has(key: string): Promise<boolean>;
	del(key: string): Promise<void>;
	keys(prefix?: string): Promise<string[]>;
};

function createNuxtHubKvAdapter(storage: InMemoryKVStorage): NuxtHubKvAdapter {
	return {
		async get<T = unknown>(key: string, type: 'text' | 'json' = 'text'): Promise<T | null> {
			if (type === 'json') {
				return (await storage.get<T>(key, 'json')) ?? null;
			}
			return (await storage.get(key, 'text')) as T | null;
		},
		async set(key: string, value: unknown, options?: { ttl?: number }): Promise<void> {
			await storage.set(key, value, options);
		},
		async has(key: string): Promise<boolean> {
			return (await storage.get(key, 'text')) != null;
		},
		async del(key: string): Promise<void> {
			await storage.delete(key);
		},
		async keys(prefix = ''): Promise<string[]> {
			return await storage.keys(prefix);
		}
	};
}

export type InMemoryBlob = {
	put(
		pathname: string,
		body: unknown,
		options?: { contentType?: string }
	): Promise<{ pathname: string; size: number }>;
	get(pathname: string): Promise<Blob | null>;
	delete(pathnames: string | string[]): Promise<void>;
	del(pathnames: string | string[]): Promise<void>;
	has(pathname: string): boolean;
};

function createInMemoryBlob(): InMemoryBlob {
	const store = new Map<string, { data: Uint8Array; type: string }>();

	const toBytes = async (body: unknown): Promise<Uint8Array> => {
		if (body instanceof Uint8Array) return body;
		if (body instanceof ArrayBuffer) return new Uint8Array(body);
		if (typeof body === 'string') return new TextEncoder().encode(body);
		if (body && typeof (body as Blob).arrayBuffer === 'function') {
			return new Uint8Array(await (body as Blob).arrayBuffer());
		}
		throw new Error('Unsupported blob body in test harness');
	};

	const blob: InMemoryBlob = {
		async put(pathname, body, options) {
			const data = await toBytes(body);
			store.set(pathname, { data, type: options?.contentType || 'application/octet-stream' });
			return { pathname, size: data.byteLength };
		},
		async get(pathname) {
			const entry = store.get(pathname);
			if (!entry) return null;
			return new Blob([entry.data as BlobPart], { type: entry.type });
		},
		async delete(pathnames) {
			for (const key of Array.isArray(pathnames) ? pathnames : [pathnames]) {
				store.delete(key);
			}
		},
		async del(pathnames) {
			return blob.delete(pathnames);
		},
		has(pathname) {
			return store.has(pathname);
		}
	};

	return blob;
}

export type RouteRuntime = {
	db: InMemorySQLDatabase;
	kv: InMemoryKVStorage;
	hubKv: NuxtHubKvAdapter;
	blob: InMemoryBlob;
	env: typeof TEST_ENV;
};

// Cloudflare Workers run a single shared isolate per request, so it's fine to
// reuse a module-scoped runtime; we just reset its contents before each test.
let runtime: RouteRuntime | null = null;

vi.mock('hub:db', () => ({
	get db() {
		if (!runtime) throw new Error('Test runtime not initialized; call setupApiRuntime() first.');
		return runtime.db;
	}
}));

vi.mock('hub:kv', () => ({
	get kv() {
		if (!runtime) throw new Error('Test runtime not initialized; call setupApiRuntime() first.');
		return runtime.hubKv;
	}
}));

vi.mock('hub:blob', () => ({
	get blob() {
		if (!runtime) throw new Error('Test runtime not initialized; call setupApiRuntime() first.');
		return runtime.blob;
	}
}));

async function buildRuntime(): Promise<RouteRuntime> {
	const db = createInMemorySQLProvider();
	const kv = createInMemoryKVProvider();
	const hubKv = createNuxtHubKvAdapter(kv);
	const blob = createInMemoryBlob();

	for (const statement of TABLES_SQL) {
		const result = await db.prepare(statement).run();
		if (!result.success) {
			throw new Error(`Failed to seed schema: ${result.error}`);
		}
	}

	return { db, kv, hubKv, blob, env: TEST_ENV };
}

export async function setupApiRuntime(): Promise<RouteRuntime> {
	const { resetConfig, clearMigrationCache } = await import('@earth-app/collegedb');
	resetConfig();
	clearMigrationCache();

	const { resetCollegeDB, ensureCollegeDB } = await import('~/server/db/schema');
	resetCollegeDB();

	runtime = await buildRuntime();
	ensureCollegeDB(runtime.env);
	// bare `kv` is auto-imported in nitro; expose the in-memory adapter for the harness
	(globalThis as Record<string, unknown>).kv = runtime.hubKv;
	return runtime;
}

export async function teardownApiRuntime(): Promise<void> {
	const { resetConfig, clearMigrationCache } = await import('@earth-app/collegedb');
	resetConfig();
	clearMigrationCache();

	const { resetCollegeDB } = await import('~/server/db/schema');
	resetCollegeDB();

	runtime = null;
	delete (globalThis as Record<string, unknown>).kv;
}

export function getRuntime(): RouteRuntime {
	if (!runtime) throw new Error('Test runtime not initialized; call setupApiRuntime() first.');
	return runtime;
}

export function eventFor(env: typeof TEST_ENV, token?: string) {
	return {
		node: { req: { headers: token ? { authorization: `Bearer ${token}` } : {} } },
		context: { cloudflare: { env } }
	} as any;
}

export async function importRoute<T = (event: any) => Promise<unknown>>(path: string): Promise<T> {
	const module = await import(path);
	return module.default as T;
}

export function mockBody(value: unknown): void {
	const m = (globalThis as any).readValidatedBody as ReturnType<typeof vi.fn>;
	m.mockResolvedValue(value);
}

export function mockParams(value: Record<string, unknown>): void {
	const m = (globalThis as any).getValidatedRouterParams as ReturnType<typeof vi.fn>;
	m.mockResolvedValue(value);
}

export function mockQuery(value: Record<string, unknown>): void {
	const m = (globalThis as any).getQuery as ReturnType<typeof vi.fn>;
	m.mockReturnValue(value);
}

export function mockCookie(value: string | null): void {
	const m = (globalThis as any).getCookie as ReturnType<typeof vi.fn>;
	m.mockReturnValue(value);
}

export function mockHeader(value: string | undefined): void {
	const m = (globalThis as any).getHeader as ReturnType<typeof vi.fn>;
	m.mockReturnValue(value);
}

export function mockMultipart(
	parts: Array<{ name?: string; filename?: string; type?: string; data: unknown }>
): void {
	const m = (globalThis as any).readMultipartFormData as ReturnType<typeof vi.fn>;
	m.mockResolvedValue(parts);
}

// #region Seed helpers — these go directly through the application code so test
// data is created exactly the way production routes would create it.

export async function seedUser(
	rt: RouteRuntime,
	options: {
		username: string;
		email: string;
		role?: Role;
		password?: string;
		permissions?: Permission[];
	}
): Promise<{ id: string; sessionToken: string }> {
	const utils = await import('#server-utils');
	const created = await utils.createUser(
		options.username,
		options.email,
		options.role ?? Role.Agent,
		rt.env
	);

	if (options.password) {
		await utils.setInitialPassword(created.id, options.password);
	}

	if (options.permissions) {
		const fetched = await utils.getUserById(created.id, rt.env);
		if (!fetched) throw new Error('Failed to load seeded user');
		await utils.patchUser(fetched, { permissions: options.permissions }, rt.env);
	}

	return created;
}

export async function seedManager(
	rt: RouteRuntime,
	username = 'manager_user',
	email = 'manager@example.com'
): Promise<{ id: string; sessionToken: string }> {
	return await seedUser(rt, {
		username,
		email,
		role: Role.Manager,
		permissions: MANAGER_PERMISSIONS
	});
}

export async function seedAgent(
	rt: RouteRuntime,
	username = 'agent_user',
	email = 'agent@example.com'
): Promise<{ id: string; sessionToken: string }> {
	return await seedUser(rt, { username, email, role: Role.Agent });
}

export async function seedCustomer(
	rt: RouteRuntime,
	options: {
		name: string;
		email: string;
		avatar_url?: string;
		tags?: Label[];
	}
): Promise<{ id: number }> {
	const utils = await import('#server-utils');
	const created = await utils.createCustomer(options, rt.env);
	return { id: created.id };
}

export async function seedLabel(_rt: RouteRuntime, name: string, color?: string): Promise<Label> {
	const utils = await import('#server-utils');
	return await utils.createLabel(name, color);
}

export async function seedTicket(
	rt: RouteRuntime,
	options: {
		title: string;
		description: string;
		customer_id: number;
		status?: TicketStatus;
		priority?: TicketPriority;
		labels?: number[];
		assignee_ids?: string[];
		private?: boolean;
		visibility?: import('~/shared/types/ticket').TicketVisibility;
	}
): Promise<{ id: number }> {
	const utils = await import('#server-utils');
	const ticket = await utils.createTicket(
		{
			title: options.title,
			description: options.description,
			customer_id: options.customer_id,
			status: options.status,
			priority: options.priority,
			labels: options.labels,
			assignee_ids: options.assignee_ids,
			private: options.private,
			visibility: options.visibility
		},
		rt.env
	);
	return { id: ticket.id };
}

// #endregion

// Each spec re-runs setup before every test (a brand-new DB + KV + a fresh
// CollegeDB init), mirroring the per-request lifecycle of a Workers isolate.
beforeEach(async () => {
	await setupApiRuntime();
});

afterEach(async () => {
	await teardownApiRuntime();
});
