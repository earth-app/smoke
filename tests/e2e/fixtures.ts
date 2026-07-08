import { test as baseTest, expect } from '@playwright/test';
import { addCoverageReport } from 'monocart-reporter';

const COVERAGE = process.env.COVERAGE === '1';

// auto-fixture that starts/stops chromium v8 coverage when COVERAGE=1
export const test = baseTest.extend<{ autoCoverage: void }>({
	autoCoverage: [
		async ({ page, browserName }, use, testInfo) => {
			const shouldCollect = COVERAGE && browserName === 'chromium';
			if (shouldCollect) {
				await page.coverage.startJSCoverage({ resetOnNavigation: false });
			}
			await use();
			if (shouldCollect) {
				// never let coverage teardown fail an otherwise-green test: a timed-out test throws
				// "Test ended" from stopJSCoverage, and a page that never navigated has nothing worth gathering
				try {
					if (page.url() === 'about:blank') return;
					const coverage = await page.coverage.stopJSCoverage();
					if (coverage.length > 0) await addCoverageReport(coverage, testInfo);
				} catch {
					// swallow; collection is best-effort, correctness of the test is not
				}
			}
		},
		{ auto: true }
	]
});

export { expect };
