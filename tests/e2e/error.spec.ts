import { expect, test } from './fixtures';
import { waitForHydration } from './utils/hydration';

// no auth: the global error boundary (src/error.vue). an unknown route renders the 404 page,
// and the "Go Back Home" button clears the error boundary and returns to the landing page.

test('an unknown route renders the error page with a working home button', async ({ page }) => {
	await page.context().clearCookies();
	const random = Math.random().toString(36).slice(2);
	await page.goto(`/this-page-does-not-exist-${random}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// the error boundary shows a red alert icon, a status/message heading, and the home button
	await expect(page.locator('[class*="text-red-500"]').first()).toBeVisible();
	await expect(page.getByRole('heading').first()).toBeVisible();
	const home = page.getByRole('button', { name: /go back home/i });
	await expect(home).toBeVisible();

	// clicking it clears the error and lands back on the landing page
	await home.click();
	await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
	await waitForHydration(page);
	await expect(page.getByRole('link', { name: /submit a request/i }).first()).toBeVisible();
});
