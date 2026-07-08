import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const integration = process.env.INTEGRATION === '1';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.test.jsonc' }
		})
	],
	resolve: {
		alias: [
			{
				find: '#server-utils',
				replacement: fileURLToPath(new URL('./tests/server-utils.ts', import.meta.url))
			},
			{
				find: 'hub:db:schema',
				replacement: fileURLToPath(new URL('./src/server/db/schema.ts', import.meta.url))
			},
			{ find: '~', replacement: fileURLToPath(new URL('./src', import.meta.url)) }
		]
	},
	test: {
		environment: 'node',
		globals: false,
		testTimeout: 30000,
		include: integration
			? ['tests/integration/**/*.spec.ts']
			: ['tests/**/*.spec.ts', 'tests/**/*.test.ts'],
		// playwright specs live under tests/e2e (playwright cli); integration is docker-gated + opt-in
		exclude: integration
			? ['node_modules/**']
			: ['tests/e2e/**', 'tests/integration/**', 'node_modules/**'],
		setupFiles: ['tests/setup.ts'],
		coverage: {
			provider: 'istanbul' as const,
			reporter: ['text', 'lcov', 'clover'],
			include: ['src/server/**', 'src/plugins/**'],
			exclude: ['**/node_modules/**', 'tests/**']
		}
	}
});
