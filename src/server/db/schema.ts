import type { DrizzleClientLike, SQLDatabase } from '@earth-app/collegedb';
import {
	createDrizzleSQLProvider,
	createNuxtHubKVProvider,
	createSQLiteProvider,
	initialize,
	isKVStorage,
	isSQLDatabase
} from '@earth-app/collegedb';
import { sql } from 'drizzle-orm';
import type { AnyD1Database } from 'drizzle-orm/d1';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { db as primaryDb } from 'hub:db';
import { kv } from 'hub:kv';

export const users = sqliteTable(
	'users',
	{
		id: text('id', { length: 32 }).primaryKey(),
		username: text('username').notNull(),
		created_at: integer('created_at')
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),
		updated_at: integer('updated_at')
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),

		// password - can be null if password was not set yet
		password_hash: blob('password_hash'),
		password_salt: blob('password_salt'),
		password_algorithm: text('password_algorithm'),

		// encrypted payload
		data: blob('data').notNull(),
		email_lookup: text('email_lookup', { length: 255 }).notNull(), // hash of email for lookup since email is encrypted

		// envelope encryption data
		wrapped_dek: blob('wrapped_dek').notNull(),
		nonce: blob('nonce').notNull(),
		tag: blob('tag').notNull(),

		algorithm: text('algorithm').notNull(),
		version: integer('version').notNull()
	},
	(table) => [
		index('idx_users_username').on(table.username),
		index('idx_users_created_at').on(table.created_at),
		index('idx_users_updated_at').on(table.updated_at),
		index('idx_users_email_lookup').on(table.email_lookup)
	]
);

export type DBUser = typeof users.$inferSelect;

export const customers = sqliteTable(
	'customers',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		avatar_url: text('avatar_url'),
		created_at: integer('created_at')
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),

		// encrypted payload
		data: blob('data').notNull(),

		// envelope encryption data
		wrapped_dek: blob('wrapped_dek').notNull(),
		nonce: blob('nonce').notNull(),
		tag: blob('tag').notNull(),

		algorithm: text('algorithm').notNull(),
		version: integer('version').notNull()
	},
	(table) => [index('idx_customers_created_at').on(table.created_at)]
);

export type DBCustomer = typeof customers.$inferSelect;

export const labels = sqliteTable(
	'labels',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		color: text('color'),
		created_at: integer('created_at')
			.notNull()
			.default(sql`(strftime('%s', 'now'))`)
	},
	(table) => [index('idx_labels_name').on(table.name)]
);

export type DBLabel = typeof labels.$inferSelect;

export const tickets = sqliteTable(
	'tickets',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		title: text('title').notNull(),
		created_at: integer('created_at')
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),
		updated_at: integer('updated_at')
			.notNull()
			.default(sql`(strftime('%s', 'now'))`),

		// unencrypted fields
		description: text('description').notNull(),
		customer_id: integer('customer_id').notNull(),
		status: text('status').notNull().default('open'),
		priority: text('priority').notNull().default('none'),
		labels: text('labels'), // comma-separated label IDs
		assignees: text('assignees'), // comma-separated user IDs
		private: integer('private').notNull().default(0), // 0 = false, 1 = true

		// encrypted payloads
		messages_data: blob('messages_data'),
		messages_wrapped_dek: blob('messages_wrapped_dek'),
		messages_nonce: blob('messages_nonce'),
		messages_tag: blob('messages_tag'),
		messages_algorithm: text('messages_algorithm'),
		messages_version: integer('messages_version'),

		attachments_data: blob('attachments_data'),
		attachments_wrapped_dek: blob('attachments_wrapped_dek'),
		attachments_nonce: blob('attachments_nonce'),
		attachments_tag: blob('attachments_tag'),
		attachments_algorithm: text('attachments_algorithm'),
		attachments_version: integer('attachments_version')
	},
	(table) => [
		index('idx_tickets_title').on(table.title),
		index('idx_tickets_description').on(table.description),
		index('idx_tickets_customer_id').on(table.customer_id),
		index('idx_tickets_labels').on(table.labels),
		index('idx_tickets_assignees').on(table.assignees),
		index('idx_tickets_status').on(table.status),
		index('idx_tickets_priority').on(table.priority),
		index('idx_tickets_created_at').on(table.created_at),
		index('idx_tickets_private').on(table.private),
		index('idx_tickets_updated_at').on(table.updated_at)
	]
);

export type DBTicket = typeof tickets.$inferSelect;

function toShardProvider(binding: unknown): SQLDatabase | null {
	if (isSQLDatabase(binding)) {
		return binding;
	}

	const candidate = binding as DrizzleClientLike & { prepare?: unknown };
	if (
		typeof candidate?.run === 'function' ||
		typeof candidate?.all === 'function' ||
		typeof candidate?.get === 'function' ||
		typeof candidate?.execute === 'function'
	) {
		return createDrizzleSQLProvider(candidate, sql);
	}

	if (typeof candidate?.prepare === 'function') {
		// d1 is the sqlite provider's intended input at runtime; its workers-types signature is
		// narrower than collegedb's SQLiteClientLike, so cast through unknown
		return createSQLiteProvider(binding as unknown as Parameters<typeof createSQLiteProvider>[0]);
	}

	try {
		return createDrizzleSQLProvider(drizzleD1(binding as AnyD1Database), sql);
	} catch {
		return null;
	}
}

export let collegeDBInitialized = false;

export function resetCollegeDB() {
	collegeDBInitialized = false;
}

// idempotent ddl; NuxtHub/wrangler have no migration files for these tables, so we create
// them at runtime across every shard (drop-in: no manual migration step to self-host)
const SCHEMA_DDL = [
	`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, password_hash BLOB, password_salt BLOB, password_algorithm TEXT, data BLOB NOT NULL, email_lookup TEXT NOT NULL, wrapped_dek BLOB NOT NULL, nonce BLOB NOT NULL, tag BLOB NOT NULL, algorithm TEXT NOT NULL, version INTEGER NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS idx_users_username ON users (username)`,
	`CREATE INDEX IF NOT EXISTS idx_users_email_lookup ON users (email_lookup)`,
	`CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at)`,
	`CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, avatar_url TEXT, created_at INTEGER NOT NULL, data BLOB NOT NULL, wrapped_dek BLOB NOT NULL, nonce BLOB NOT NULL, tag BLOB NOT NULL, algorithm TEXT NOT NULL, version INTEGER NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers (created_at)`,
	`CREATE TABLE IF NOT EXISTS labels (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT, created_at INTEGER NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS idx_labels_name ON labels (name)`,
	`CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, description TEXT NOT NULL, customer_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'none', labels TEXT, assignees TEXT, private INTEGER NOT NULL DEFAULT 0, messages_data BLOB, messages_wrapped_dek BLOB, messages_nonce BLOB, messages_tag BLOB, messages_algorithm TEXT, messages_version INTEGER, attachments_data BLOB, attachments_wrapped_dek BLOB, attachments_nonce BLOB, attachments_tag BLOB, attachments_algorithm TEXT, attachments_version INTEGER)`,
	`CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON tickets (customer_id)`,
	`CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status)`,
	`CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets (created_at)`
];

let schemaEnsured = false;

export function resetSchemaEnsured() {
	schemaEnsured = false;
}

// run the ddl on every discovered shard once per process (idempotent via IF NOT EXISTS)
export async function ensureSchema(env: any): Promise<void> {
	if (schemaEnsured) return;

	const bindings: unknown[] = [primaryDb];
	for (const key of Object.keys(env ?? {})) {
		if (key === 'KV' || key === 'CACHE' || key === 'EMAIL' || key === 'ShardCoordinator') continue;
		if (key.startsWith('DB_') || key.startsWith('DB-') || key.startsWith('db-')) {
			if (env[key]) bindings.push(env[key]);
		}
	}

	for (const binding of bindings) {
		let client: DrizzleClientLike | null = null;
		const candidate = binding as DrizzleClientLike & { prepare?: unknown };
		if (typeof candidate?.run === 'function') {
			client = candidate;
		} else if (typeof candidate?.prepare === 'function') {
			try {
				client = drizzleD1(binding as AnyD1Database);
			} catch {
				client = null;
			}
		}
		if (!client?.run) continue;

		for (const statement of SCHEMA_DDL) {
			try {
				await client.run(sql.raw(statement));
			} catch (error) {
				console.warn('ensureSchema statement failed', error);
			}
		}
	}

	schemaEnsured = true;
}

export function ensureCollegeDB(env: any) {
	if (collegeDBInitialized) return;

	// check master key + hmac key as apart of initialization
	if (!env.MASTER_KEY) {
		throw createError({
			statusCode: 500,
			message:
				'Master encryption key not configured; please set MASTER_KEY in your .env file. This key is required for encrypting sensitive data and should be a secure, random string.',
			data: { field: 'MASTER_KEY' }
		});
	}

	if (!env.HMAC_SECRET) {
		throw createError({
			statusCode: 500,
			message:
				'HMAC secret not configured; please set HMAC_SECRET in your .env file. This key is required for generating secure hashes. You can generate it by running `openssl rand -hex 32` in your terminal.',
			data: { field: 'HMAC_SECRET' }
		});
	}

	const primaryProvider = toShardProvider(primaryDb);
	if (!primaryProvider) {
		throw createError({
			statusCode: 500,
			message: 'Primary database binding is not a recognized SQL provider'
		});
	}

	const shards: Record<string, SQLDatabase> = { 'db-primary': primaryProvider };

	const candidateKeys = Object.keys(env).filter((k) => {
		if (!k) return false;
		if (k === 'KV' || k === 'CACHE' || k === 'EMAIL' || k === 'ShardCoordinator') return false;

		return k.startsWith('DB_') || k.startsWith('DB-') || k.startsWith('db-');
	});

	for (const key of candidateKeys) {
		const binding = env[key];
		if (!binding) continue;

		const provider = toShardProvider(binding);
		if (!provider) {
			console.warn(`Binding ${key} is not a valid SQL provider. Skipping.`);
			continue;
		}

		const shardName = key.toLowerCase().replace(/_/g, '-');
		shards[shardName] = provider;
	}

	initialize({
		kv: isKVStorage(kv) ? kv : createNuxtHubKVProvider(kv),
		shards,
		strategy: {
			read: 'location',
			write: 'hash'
		}
	});

	collegeDBInitialized = true;
}
