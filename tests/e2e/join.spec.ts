import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// main lane: a manager/admin mints an agent invite (admin-gated api), then the invitee completes
// the /join wizard in the ui and lands authenticated. the post-join redirect renders the dashboard,
// which is flaky on local webkit, so scope to desktop + mobile chrome.
test.beforeEach(({ browserName }) => {
	test.skip(
		browserName === 'webkit',
		'authenticated dashboard rendering is flaky on local webkit; covered on desktop + mobile-pixel'
	);
});

async function mintInvite(page: Page): Promise<string> {
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

	const token = await loginViaApi(page.request, TEST_ADMIN);
	const res = await page.request.post('/api/agents/invite', {
		headers: { Authorization: `Bearer ${token}` },
		data: { maxUses: 5, ttlMinutes: 60 }
	});
	expect(res.ok(), `invite create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	return (await res.json()).token as string;
}

test('an invited agent can create an account and land on the dashboard', async ({ page }) => {
	const inviteToken = await mintInvite(page);
	// drop the admin session so the join establishes a fresh agent session
	await page.context().clearCookies();

	await page.goto(`/join/${inviteToken}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /join the team/i })).toBeVisible();

	// no hyphen: the username schema is /^[a-zA-Z0-9_$%~.<>]+$/
	const username = `agent${Date.now()}`;
	const password = 'Password123!';
	await page.getByRole('textbox', { name: /username/i }).fill(username);
	// the email field is required (its a11y name carries a required marker), so target the input directly
	await page.locator('input[type="email"]').fill(`${username}@smoke.test`);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByLabel(/confirm password/i).fill(password);
	await page.getByRole('button', { name: /create account/i }).click();

	await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
	const cookies = await page.context().cookies();
	expect(cookies.some((c) => c.name === 'session_token' && !!c.value)).toBeTruthy();
});

test('an invalid invite token shows the not-found state', async ({ page }) => {
	await page.context().clearCookies();
	await page.goto('/join/not-a-real-token', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /invite not found/i })).toBeVisible();
	await expect(page.getByRole('link', { name: /go to login/i })).toBeVisible();
});
