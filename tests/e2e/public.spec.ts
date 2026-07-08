import { expect, test } from './fixtures';
import { waitForHydration } from './utils/hydration';

// main lane, no auth: the public request funnel (landing -> submit -> status).

test('the landing page renders and links to the submit flow', async ({ page }) => {
	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	const submit = page.getByRole('link', { name: /submit a request/i }).first();
	await expect(submit).toBeVisible();
	await submit.click();
	await expect(page).toHaveURL(/\/submit/);
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /submit a request/i })).toBeVisible();
});

test('submitting the public form yields a ticket id and a working track link', async ({ page }) => {
	await page.goto('/submit', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	await page.getByRole('textbox', { name: /^email$/i }).fill(`public-${Date.now()}@smoke.test`);
	await page.getByRole('textbox', { name: /^subject$/i }).fill('E2E public request');
	await page
		.getByRole('textbox', { name: /^description$/i })
		.fill('submitted by the public e2e spec');
	await page.getByRole('button', { name: /submit request/i }).click();

	// success card shows the ticket id and a track button
	await expect(page.getByText(/request received/i)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(/#\d+/)).toBeVisible();
	const track = page.getByRole('link', { name: /track your request/i });
	await expect(track).toBeVisible();

	await track.click();
	await expect(page).toHaveURL(/\/status\//);
	await waitForHydration(page);

	// the status page renders the ticket heading and a status badge
	await expect(page.getByRole('heading', { name: /request status/i })).toBeVisible();
	await expect(page.getByText(/ticket #\d+/i)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(/\bopen\b/i).first()).toBeVisible();
});

test('an unknown status token shows the not-found card', async ({ page }) => {
	await page.goto('/status/not-a-real-token?id=999999999', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByText(/request not found/i)).toBeVisible({ timeout: 30_000 });
});
