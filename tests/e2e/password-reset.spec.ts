import { expect, test } from './fixtures';
import { waitForHydration } from './utils/hydration';

// main lane, no auth: the agent forgot-password flow. the 8-digit code is emailed out of band, so
// the full reset happy-path is unit-tested (tests/api/password-reset.spec.ts); here we cover the
// request step and that the code-entry step renders (the response is identical for unknown emails).

test('requesting a reset code advances to the code-entry step', async ({ page }) => {
	await page.goto('/reset-password', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /reset password/i })).toBeVisible();

	await page.getByRole('textbox', { name: /email/i }).fill('admin@smoke.test');
	await page.getByRole('button', { name: /send reset code/i }).click();

	await expect(page.getByRole('button', { name: /set new password/i })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByRole('textbox', { name: /reset code/i })).toBeVisible();
});

test('the reset page links back to login', async ({ page }) => {
	await page.goto('/reset-password', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('link', { name: /back to login/i })).toBeVisible();
});
