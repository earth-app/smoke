import { expect, test } from './fixtures';
import { loginUi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// main lane: the customer portal. anonymous visitors get the otp login; a signed-in staffer is
// shown the "you're staff" notice instead of the customer view (no dead-end for staff).

test('the portal login renders for an anonymous visitor', async ({ page }) => {
	await page.context().clearCookies();
	await page.goto('/portal/login', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /customer portal/i })).toBeVisible();
	await expect(page.getByRole('textbox', { name: /email/i }).first()).toBeVisible();
});

test('visiting /portal anonymously redirects to the portal login', async ({ page }) => {
	await page.context().clearCookies();
	await page.goto('/portal', { waitUntil: 'domcontentloaded' });
	await expect(page).toHaveURL(/\/portal\/login/, { timeout: 30_000 });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /customer portal/i })).toBeVisible();
});

test('a signed-in staffer sees the staff notice on the portal', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'authenticated flows are flaky on local webkit');
	await page.context().clearCookies();
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

	await page.goto('/portal', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /signed in as staff/i })).toBeVisible();
	await expect(page.getByRole('link', { name: /dashboard/i }).first()).toBeVisible();
});
