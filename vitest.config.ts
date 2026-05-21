import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.test.jsonc' }
		})
	],
	resolve: {
		alias: {
			'~': fileURLToPath(new URL('./src', import.meta.url))
		}
	},
	test: {
		environment: 'node',
		globals: false,
		testTimeout: 30000,
		include: ['tests/**/*.spec.ts', 'tests/**/*.test.ts'],
		setupFiles: ['tests/setup.ts'],
		coverage: {
			// The Cloudflare Workers vitest pool runs tests in real Workers isolates,
			// where v8 native coverage isn't available; Istanbul instrumentation works.
			provider: 'istanbul' as const,
			reporter: ['text', 'lcov'],
			include: ['src/server/**', 'src/plugins/**'],
			exclude: ['**/node_modules/**', 'tests/**']
		}
	}
});
