import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// main lane: an admin is seeded by global-setup. covers the auth gate,
// ui login, logout, the admin-only routes, and the route middleware
// (staff.ts / admin.ts / setup.global.ts).

type Creds = { username: string; password: string };

async function authenticate(page: import('@playwright/test').Page, creds: Creds = TEST_ADMIN) {
	await loginUi(page, creds);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}

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
	await authenticate(page, TEST_ADMIN);
	await waitForHydration(page);
	const cookies = await page.context().cookies();
	expect(cookies.some((c) => c.name === 'session_token' && !!c.value)).toBeTruthy();
});

test('login honours the redirect query param', async ({ page }) => {
	await page.context().clearCookies();
	// loginUi preserves the ?redirect= already on the url, so login lands on the target
	await page.goto('/login?redirect=%2Fdashboard%2Ftickets', { waitUntil: 'domcontentloaded' });
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard\/tickets/, { timeout: 15_000 });
});

test('logout returns to a public page', async ({ page }) => {
	await page.context().clearCookies();
	await authenticate(page, TEST_ADMIN);
	await waitForHydration(page);

	// the account menu is the last button in the dashboard header (avatar name is hidden on mobile)
	await page.locator('header button').last().click();
	await page.getByRole('menuitem', { name: /log ?out/i }).click();

	await expect(page).toHaveURL(/\/login|\/$/, { timeout: 30_000 });
});

test('admin can reach the admin-only settings and users pages', async ({ page }) => {
	await page.context().clearCookies();
	await authenticate(page, TEST_ADMIN);

	await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/settings/);
	await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible();

	await page.goto('/dashboard/users', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/users/);
});

test('a non-admin agent is redirected away from admin-only pages by the admin middleware', async ({
	page,
	browserName
}) => {
	test.skip(browserName === 'webkit', 'authenticated dashboard rendering is flaky on local webkit');
	// mint an agent invite as the admin, then redeem it to create a fresh agent account
	await page.context().clearCookies();
	await authenticate(page, TEST_ADMIN);
	const adminToken = await loginViaApi(page.request, TEST_ADMIN);
	const invite = await page.request.post('/api/agents/invite', {
		headers: { Authorization: `Bearer ${adminToken}` },
		data: { maxUses: 5, ttlMinutes: 60 }
	});
	expect(invite.ok(), `invite failed: ${invite.status()} ${await invite.text()}`).toBeTruthy();
	const inviteToken = (await invite.json()).token as string;

	const agent = { username: `agent${Date.now()}`, password: 'Password123!' };
	const join = await page.request.post('/api/agents/join', {
		data: {
			token: inviteToken,
			username: agent.username,
			password: agent.password,
			email: `${agent.username}@smoke.test`
		}
	});
	expect(join.ok(), `join failed: ${join.status()} ${await join.text()}`).toBeTruthy();

	// sign in as the agent (a non-admin without ManageSettings/ManageUsers)
	await page.context().clearCookies();
	await authenticate(page, agent);

	// admin.ts bounces the agent from settings + users back to /dashboard
	await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
	await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
	await waitForHydration(page);

	await page.goto('/dashboard/users', { waitUntil: 'domcontentloaded' });
	await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

	// but the agent still reaches a staff-gated page (staff.ts allows any agent)
	await page.goto('/dashboard/tickets', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/tickets/, { timeout: 30_000 });
});

test('setup.global sends a completed instance away from /setup', async ({ page }) => {
	// the admin is already seeded (global-setup), so needsSetup is false; /setup redirects home
	await page.context().clearCookies();
	await page.goto('/setup', { waitUntil: 'domcontentloaded' });
	await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
	await waitForHydration(page);
	await expect(page.getByRole('link', { name: /submit a request/i }).first()).toBeVisible();
});
