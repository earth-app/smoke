import {
	createDrizzleSQLProvider,
	createNuxtHubKVProvider,
	DrizzleClientLike,
	initialize,
	SQLDatabase
} from '@earth-app/collegedb';
import { sql } from 'drizzle-orm';
import { AnyD1Database, drizzle as drizzleD1 } from 'drizzle-orm/d1';
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

		// password
		password_hash: blob('password_hash').notNull(),
		password_salt: blob('password_salt').notNull(),
		password_algorithm: text('password_algorithm').notNull(),

		// encrypted payload
		data: blob('data').notNull(),

		// envelope encryption data
		wrapped_dek: blob('wrapped_dek').notNull(),
		nonce: blob('nonce').notNull(),
		tag: blob('tag').notNull(),

		algorithm: text('algorithm').notNull(),
		version: integer('version').notNull()
	},
	(table) => [
		index('idx_users_username').on(table.username),
		index('idx_users_created_at').on(table.created_at)
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

		// unencrypted fields
		description: text('description').notNull(),
		customer_id: integer('customer_id').notNull(),
		status: text('status').notNull().default('open'),
		priority: text('priority').notNull().default('none'),
		labels: text('labels'), // comma-separated label IDs
		assignees: text('assignees'), // comma-separated user IDs

		// encrypted payloads
		messages_data: blob('messages_data').notNull(),
		attachments_data: blob('attachments_data').notNull(),

		// envelope encryption data
		wrapped_dek: blob('wrapped_dek').notNull(),
		nonce: blob('nonce').notNull(),
		tag: blob('tag').notNull(),

		algorithm: text('algorithm').notNull(),
		version: integer('version').notNull()
	},
	(table) => [
		index('idx_tickets_title').on(table.title),
		index('idx_tickets_description').on(table.description),
		index('idx_tickets_customer_id').on(table.customer_id),
		index('idx_tickets_labels').on(table.labels),
		index('idx_tickets_assignees').on(table.assignees),
		index('idx_tickets_status').on(table.status),
		index('idx_tickets_priority').on(table.priority),
		index('idx_tickets_created_at').on(table.created_at)
	]
);

export type DBTicket = typeof tickets.$inferSelect;

// collegedb initialization

export let collegeDBInitialized = false;

export function ensureCollegeDB(env: any) {
	if (collegeDBInitialized) return;

	// check master key as apart of initialization
	if (!env.MASTER_KEY) {
		throw createError({
			statusCode: 500,
			message: 'Master encryption key not configured',
			data: { field: 'MASTER_KEY' }
		});
	}

	const candidateKeys = Object.keys(env).filter((k) => {
		if (!k) return false;
		if (k === 'KV' || k === 'CACHE' || k === 'EMAIL' || k === 'ShardCoordinator') return false;

		return k.startsWith('DB_') || k.startsWith('DB-') || k.startsWith('db-');
	});

	const shards: Record<string, SQLDatabase> = {
		'db-primary': createDrizzleSQLProvider(primaryDb, sql)
	};

	for (const key of candidateKeys) {
		const binding = env[key];
		if (!binding) continue;

		let provider;

		if (
			typeof (binding as DrizzleClientLike).run === 'function' ||
			typeof (binding as DrizzleClientLike).all === 'function' ||
			typeof (binding as DrizzleClientLike).get === 'function' ||
			typeof (binding as DrizzleClientLike).execute === 'function'
		) {
			provider = createDrizzleSQLProvider(binding as DrizzleClientLike, sql);
			console.log(`Binding ${key} detected as Drizzle client. Added Drizzle client provider.`);
		} else {
			try {
				provider = createDrizzleSQLProvider(drizzleD1(binding as AnyD1Database), sql);
				console.log(`Binding ${key} detected as D1 database. Added Drizzle client provider.`);
			} catch (err) {
				console.warn(`Binding ${key} is not a valid Drizzle client or D1 database. Skipping.`);
				continue;
			}
		}

		const shardName = key.toLowerCase().replace(/_/g, '-');
		shards[shardName] = provider;
	}

	initialize({
		kv: createNuxtHubKVProvider(kv),
		shards,
		strategy: {
			read: 'location',
			write: 'hash'
		}
	});

	collegeDBInitialized = true;
}
