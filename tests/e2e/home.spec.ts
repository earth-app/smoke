import { expect, test } from './fixtures';
import { waitForHydration } from './utils/hydration';

// minimal smoke check so the e2e lane is runnable now; the landing page is being built in
// parallel, so assert the page responds and hydrates rather than any specific copy
test('home renders', async ({ page }) => {
	const res = await page.goto('/', { waitUntil: 'domcontentloaded' });
	expect(res?.ok()).toBeTruthy();
	await waitForHydration(page);
	await expect(page.locator('body')).toBeVisible();
});
