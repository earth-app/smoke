import { expect, test } from '@playwright/test';
import { TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// setup lane only: fresh unseeded server on 4001, no admin exists yet.
// walks the /setup wizard end to end and asserts the first-run redirect.

test.describe.configure({ mode: 'serial' });

test('unset-up server redirects / to /setup', async ({ page }) => {
	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await expect(page).toHaveURL(/\/setup$/);
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /welcome to smoke/i })).toBeVisible();
});

test('the email channel step exposes the inbound receiving options', async ({ page }) => {
	// runs before the completion test so no admin exists yet; explores step 1 without submitting
	await page.goto('/setup', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	if (/\/login/.test(page.url())) {
		test.skip(true, 'admin already exists on this fresh server');
	}

	// step 0: a valid admin account is required to advance to the email step
	await expect(page.getByRole('heading', { name: /admin account/i })).toBeVisible();
	await page.getByRole('textbox', { name: /username/i }).fill(TEST_ADMIN.username);
	await page.getByLabel('Email', { exact: true }).fill(TEST_ADMIN.email);
	await page.getByLabel('Password', { exact: true }).fill(TEST_ADMIN.password);
	await page.getByLabel(/confirm password/i).fill(TEST_ADMIN.password);
	await page.getByRole('button', { name: /next/i }).click();

	// step 1: both the sending and receiving subsections render
	await expect(page.getByRole('heading', { name: /email channel/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /sending \(outbound\)/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /receiving \(inbound\)/i })).toBeVisible();

	// default inbound is cloudflare routing: no imap host field yet
	await expect(page.getByLabel('Host', { exact: true })).toHaveCount(0);

	// choosing a custom mailbox reveals the poll host/port inputs and they accept input
	await page.getByLabel('Inbound Method', { exact: true }).click();
	await page.getByRole('option', { name: /custom imap\/pop3 mailbox/i }).click();
	const host = page.getByLabel('Host', { exact: true });
	await expect(host).toBeVisible();
	await host.fill('imap.smoke.test');
	const port = page.getByLabel('Port', { exact: true });
	await port.fill('993');
	await expect(host).toHaveValue('imap.smoke.test');
	await expect(port).toHaveValue('993');

	// configure later hides the mailbox fields again
	await page.getByLabel('Inbound Method', { exact: true }).click();
	await page.getByRole('option', { name: /configure later/i }).click();
	await expect(page.getByLabel('Host', { exact: true })).toHaveCount(0);
});

test('completes the setup wizard and lands authenticated on the dashboard', async ({ page }) => {
	await page.goto('/setup', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// if a prior test already seeded the admin, the page bounces to /login; skip
	if (/\/login/.test(page.url())) {
		test.skip(true, 'admin already exists on this fresh server');
	}

	// step 0: admin account
	await expect(page.getByRole('heading', { name: /admin account/i })).toBeVisible();
	await page.getByRole('textbox', { name: /username/i }).fill(TEST_ADMIN.username);
	await page.getByLabel('Email', { exact: true }).fill(TEST_ADMIN.email);
	await page.getByLabel('Password', { exact: true }).fill(TEST_ADMIN.password);
	await page.getByLabel(/confirm password/i).fill(TEST_ADMIN.password);
	await page.getByRole('button', { name: /next/i }).click();

	// step 1: email channel (cloudflare is the default select value)
	await expect(page.getByRole('heading', { name: /email channel/i })).toBeVisible();
	await page.getByRole('textbox', { name: /support email/i }).fill('support@smoke.test');
	await page.getByRole('button', { name: /next/i }).click();

	// step 2: cloudflare (optional). the email-sending onboarding panel renders here; skip linking
	await expect(page.getByRole('heading', { name: /cloudflare/i })).toBeVisible();
	await expect(page.getByText('Cloudflare Email Sending', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: /next/i }).click();

	// step 3: branding (optional)
	await expect(page.getByRole('heading', { name: /branding/i })).toBeVisible();
	await page.getByRole('textbox', { name: /site name/i }).fill('Smoke Test Desk');
	await page.getByRole('button', { name: /next/i }).click();

	// step 4: finish. the summary carries the new inbound-email row (default routing)
	await expect(page.getByRole('heading', { name: /ready to finish/i })).toBeVisible();
	await expect(page.getByText('Inbound Email', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: /finish setup/i }).click();

	// lands on the dashboard (setup succeeded) or /login (409 already-set-up race)
	await expect(page).toHaveURL(/\/dashboard|\/login/, { timeout: 30_000 });

	if (/\/dashboard/.test(page.url())) {
		await waitForHydration(page);
		// a session was established: the session_token cookie is present
		const cookies = await page.context().cookies();
		expect(cookies.some((c) => c.name === 'session_token' && !!c.value)).toBeTruthy();
	}
});
