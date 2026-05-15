import type { DrizzleClientLike, SQLDatabase } from '@earth-app/collegedb';
import {
	createDrizzleSQLProvider,
	createNuxtHubKVProvider,
	initialize
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
		index('idx_tickets_updated_at').on(table.updated_at)
	]
);

export type DBTicket = typeof tickets.$inferSelect;

// collegedb initialization

export let collegeDBInitialized = false;

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
