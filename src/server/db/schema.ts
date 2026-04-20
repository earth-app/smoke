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
		created_at: integer('created_at').notNull(),

		// password
		password_hash: blob('password_hash').notNull(),
		password_salt: blob('password_salt').notNull(),
		password_algorithm: text('password_algorithm').notNull(),

		// encrypted payload
		data: blob('data').notNull(),

		// envelope encryption data
		wrapped_dek: blob('dek').notNull(),
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

export const customers = sqliteTable(
	'customers',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		avatar_url: text('avatar_url'),
		created_at: integer('created_at').notNull(),

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

export const labels = sqliteTable(
	'labels',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		color: text('color')
	},
	(table) => [index('idx_labels_name').on(table.name)]
);

export let collegeDBInitialized = false;

export function ensureCollegeDB(env: any) {
	if (collegeDBInitialized) return;

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
