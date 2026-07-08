import { expect, test } from './fixtures';
import { loginUi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// main lane: an admin is seeded by global-setup. covers the auth gate,
// ui login, logout, and the admin-only routes.

test('unauthenticated visit to /dashboard redirects to /login with a redirect param', async ({
	page
}) => {
	await page.context().clearCookies();
	await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
	await expect(page).toHaveURL(/\/login\?redirect=/);
	await waitForHydration(page);
	expect(decodeURIComponent(page.url())).toContain('/dashboard');
});

test('logging in through the ui lands on the dashboard', async ({ page }) => {
	await page.context().clearCookies();
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
	await waitForHydration(page);
	const cookies = await page.context().cookies();
	expect(cookies.some((c) => c.name === 'session_token' && !!c.value)).toBeTruthy();
});

test('login honours the redirect query param', async ({ page }) => {
	await page.context().clearCookies();
	await page.goto('/login?redirect=%2Fdashboard%2Ftickets', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard\/tickets/, { timeout: 30_000 });
});

test('logout returns to a public page', async ({ page }) => {
	await page.context().clearCookies();
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
	await waitForHydration(page);

	// the account menu is the last button in the dashboard header (avatar name is hidden on mobile)
	await page.locator('header button').last().click();
	await page.getByRole('menuitem', { name: /log ?out/i }).click();

	await expect(page).toHaveURL(/\/login|\/$/, { timeout: 30_000 });
});

test('admin can reach the admin-only settings and users pages', async ({ page }) => {
	await page.context().clearCookies();
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

	await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/settings/);
	await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible();

	await page.goto('/dashboard/users', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/users/);
});
