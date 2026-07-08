import { expect, test } from './fixtures';
import { loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// main lane, runs across desktop + mobile projects (pixel 7 / iphone 15).
// checks layout holds up: no horizontal overflow, sidebar toggles, navbar usable.

async function authenticate(page: import('@playwright/test').Page, baseURL?: string) {
	const token = await loginViaApi(page.request, TEST_ADMIN);
	await page.context().addCookies([
		{
			name: 'session_token',
			value: token,
			url: baseURL ?? 'http://127.0.0.1:4000',
			sameSite: 'Lax'
		}
	]);
}

async function noHorizontalOverflow(page: import('@playwright/test').Page) {
	return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

test('the landing page has no horizontal overflow', async ({ page }) => {
	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	expect(await noHorizontalOverflow(page)).toBeTruthy();
	// the navbar brand link home is reachable
	await expect(page.getByRole('link', { name: /log in/i }).first()).toBeVisible();
});

test('the submit page has no horizontal overflow', async ({ page }) => {
	await page.goto('/submit', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	expect(await noHorizontalOverflow(page)).toBeTruthy();
});

test('the dashboard sidebar toggles and the header stays usable', async ({ page, baseURL }) => {
	await authenticate(page, baseURL);
	await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard/);

	const sidebar = page.locator('aside').first();
	await expect(sidebar).toBeVisible();
	const before = (await sidebar.boundingBox())?.width ?? 0;

	// the header toggle collapses/expands the sidebar
	const toggle = page.getByRole('button', { name: /collapse sidebar|expand sidebar/i });
	await toggle.click();
	await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).not.toBe(before);

	expect(await noHorizontalOverflow(page)).toBeTruthy();
});
