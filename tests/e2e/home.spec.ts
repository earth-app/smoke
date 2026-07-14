import { expect, test } from './fixtures';
import { loginUi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// the landing page (src/pages/index.vue) renders three role-aware variants: anonymous (hero +
// public-request funnel), a returning guest (My Requests from localStorage), and staff (dashboard
// links + analytics widgets). drive each branch.

async function authenticate(page: import('@playwright/test').Page) {
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

test('home renders', async ({ page }) => {
	const res = await page.goto('/', { waitUntil: 'domcontentloaded' });
	expect(res?.ok()).toBeTruthy();
	await waitForHydration(page);
	await expect(page.locator('body')).toBeVisible();
});

test('the anonymous landing page shows the hero, the funnel buttons, and the feature cards', async ({
	page
}) => {
	await page.context().clearCookies();
	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// the three funnel buttons in the hero (scoped to main; the navbar carries similar links)
	const hero = page.locator('#main-content');
	await expect(hero.getByRole('link', { name: /submit a request/i }).first()).toBeVisible();
	await expect(hero.getByRole('link', { name: /browse requests/i }).first()).toBeVisible();
	await expect(hero.getByRole('link', { name: /my requests/i }).first()).toBeVisible();

	// the three feature cards
	await expect(page.getByRole('heading', { name: /submit in seconds/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /track anytime/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /replies by email/i })).toBeVisible();

	// the public-requests browse section (either a list or its own empty-state)
	await expect(page.getByRole('heading', { name: /public requests/i })).toBeVisible();
	await expect(page.getByRole('link', { name: /search all/i })).toBeVisible();
});

test('a returning guest sees their saved requests on the landing page', async ({ page }) => {
	await page.context().clearCookies();
	// seed a saved request before any app script runs so useMyRequests hydrates it
	await page.addInitScript(() => {
		window.localStorage.setItem(
			'smoke:my-requests',
			JSON.stringify([
				{ id: 4242, token: 'seed-token', title: 'My Seeded Request', created_at: Date.now() }
			])
		);
	});
	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// the TicketMyRequests panel renders its h3 heading + the seeded row
	await expect(page.getByRole('heading', { name: 'My Requests', exact: true })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByText('My Seeded Request')).toBeVisible();
	await expect(page.getByText(/ticket #4242/i)).toBeVisible();
});

test('a signed-in staffer sees the dashboard links and the summary widgets', async ({
	page,
	browserName
}) => {
	test.skip(browserName === 'webkit', 'authenticated home rendering is flaky on local webkit');
	await page.context().clearCookies();
	await authenticate(page);

	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// the staff hero buttons replace the public funnel
	await expect(page.getByRole('link', { name: /go to dashboard/i }).first()).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByRole('link', { name: /view tickets/i })).toBeVisible();

	// the staff quick-links row
	await expect(page.getByRole('link', { name: /^tickets$/i }).first()).toBeVisible();
	await expect(page.getByRole('link', { name: /^customers$/i }).first()).toBeVisible();

	// the admin sees the analytics + recent-tickets widgets
	await expect(page.getByText(/at a glance/i)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('heading', { name: /recent tickets/i })).toBeVisible({
		timeout: 30_000
	});
});
