import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const isCI = !!process.env.CI;
const COVERAGE = process.env.COVERAGE === '1';
const SETUP = process.env.PLAYWRIGHT_SETUP === '1';

// setup lane hits a fresh unseeded server on 4001; the main lane hits 4000
const BASE_URL = SETUP ? 'http://127.0.0.1:4001' : 'http://127.0.0.1:4000';

const baseReporters: any[] = [['list']];
if (isCI) baseReporters.push(['github']);

const reporters: any[] =
	COVERAGE && !SETUP
		? [
				...baseReporters,
				[
					'monocart-reporter',
					{
						name: 'Smoke E2E',
						outputFile: './coverage/report.html',
						coverage: {
							name: 'Smoke Coverage',
							outputDir: './coverage',
							reports: [['lcovonly', { file: 'lcov.info' }], 'console-summary'],
							entryFilter: (entry: { url: string }) => {
								const url = entry.url || '';
								if (!url) return false;
								if (url.includes('node_modules')) return false;
								if (url.includes('/_nuxt/builds/')) return false;
								if (url.startsWith('chrome-extension:')) return false;
								// only the hashed js chunks carry sourcemapped app code; the page-document
								// navigations (BASE_URL/...) have no source mapping and would otherwise report
								// as unmatched dist urls that codecov can't place on the repo tree
								return url.includes('/_nuxt/');
							},
							sourceFilter: (path: string) =>
								path.includes('src/') && !path.includes('node_modules'),
							// codecov matches coverage onto the repo tree by repo-relative path, so every
							// unpacked source must come out as `src/...`; sourcemap sources can be absolute
							// in CI (/home/runner/work/smoke/smoke/src/...) or carry a virtual prefix, so
							// trim everything up to the first src/ segment
							sourcePath: (filePath: string) => {
								const i = filePath.indexOf('src/');
								return i >= 0 ? filePath.slice(i) : filePath;
							}
						}
					}
				]
			]
		: SETUP
			? baseReporters
			: [...baseReporters, ['html', { open: 'never', outputFolder: 'playwright-report' }]];

export default defineConfig({
	testDir: './tests/e2e',
	// the setup lane targets only setup.spec.ts (no-admin-yet path); the main lane ignores it + helpers
	...(SETUP
		? { testMatch: ['**/setup.spec.ts'] }
		: { testIgnore: ['**/setup.spec.ts', '**/utils/**', '**/fixtures.ts'] }),
	fullyParallel: false,
	forbidOnly: isCI,
	retries: isCI ? 2 : 0,
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 15_000 },
	reporter: reporters,
	outputDir: 'playwright-results',
	// the setup lane tests the un-seeded first-run path, so it skips admin-seeding global setup
	...(SETUP
		? {}
		: {
				globalSetup: fileURLToPath(new URL('./tests/e2e/utils/global-setup.ts', import.meta.url))
			}),
	webServer: SETUP
		? {
				// dev:setup boots a fresh instance on 4001; reuse:false guarantees a clean unseeded server
				command: 'bun run dev:setup',
				url: BASE_URL,
				reuseExistingServer: false,
				timeout: 240_000,
				stdout: 'pipe',
				stderr: 'pipe'
			}
		: {
				// coverage runs against a production build + node preview (source-mapped);
				// the normal lane uses the dev server. build:e2e runs first via the test:e2e:coverage script
				command: COVERAGE ? 'bun run preview:e2e' : 'bun run dev:test',
				url: BASE_URL,
				reuseExistingServer: !isCI,
				timeout: 240_000,
				stdout: 'pipe',
				stderr: 'pipe'
			},
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		actionTimeout: 20_000,
		navigationTimeout: 90_000
	},
	projects: SETUP
		? [{ name: 'setup', use: { ...devices['Desktop Chrome'] } }]
		: [
				{ name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
				{ name: 'mobile-pixel', use: { ...devices['Pixel 7'] } },
				{ name: 'mobile-safari', use: { ...devices['iPhone 15'] } }
			]
});
