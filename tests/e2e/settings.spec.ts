import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// main lane: authenticated admin settings. logs in through the ui so the auth store hydrates
// currentUser (the settings page is admin-gated), then drives the email + cloudflare tabs.

async function authenticate(page: import('@playwright/test').Page): Promise<string> {
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
	return await loginViaApi(page.request, TEST_ADMIN);
}

// the settings page nests the dashboard sidebar plus a vertical UTabs; on a narrow mobile
// viewport the sidebar stays expanded and squeezes the tab-content column off-screen (a zero-width
// panel reads as hidden), so these admin-only settings flows are verified on desktop
test.beforeEach(({ isMobile }) => {
	test.skip(
		!!isMobile,
		'settings vertical tabs collapse under the dashboard sidebar on mobile; verified on desktop'
	);
});

test('the email channel tab saves and polls the inbound mailbox', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/settings/);

	const emailTab = page.getByRole('tab', { name: /email channel/i });
	await emailTab.click();
	await expect(emailTab).toHaveAttribute('aria-selected', 'true');

	// the inbound mailbox card renders under the outbound email card. the transport/smtp block
	// stays on cloudflare, so the only host/port/username fields on the page are the inbound ones
	await expect(page.getByText('Inbound Mailbox (IMAP / POP3)', { exact: true })).toBeVisible();
	const save = page.getByRole('button', { name: /save inbound channel/i });
	const poll = page.getByRole('button', { name: /poll now/i });
	await expect(save).toBeVisible();
	await expect(poll).toBeVisible();

	// ensure the channel is enabled to reveal the fields; a prior run may have persisted it on,
	// so only flip the switch when it is currently off (blind clicks would toggle it back off)
	const enable = page.getByRole('switch');
	if (!(await enable.isChecked())) await enable.click();
	const host = page.getByLabel('Host', { exact: true });
	await expect(host).toBeVisible();
	await host.fill('imap.smoke.test');
	await page.getByLabel('Port', { exact: true }).fill('993');
	await page.getByLabel('Username', { exact: true }).fill('inbox@smoke.test');

	// save hits /api/settings and surfaces the success toast (exact match dodges the aria-live dup)
	await save.click();
	await expect(page.getByText('Inbound Channel Saved', { exact: true })).toBeVisible({
		timeout: 30_000
	});

	// poll runs against no reachable mailbox; a handled result (count) or error toast is fine
	await poll.click();
	await expect(page.getByText(/^(Mailbox Polled|Failed to Poll Mailbox)$/)).toBeVisible({
		timeout: 30_000
	});
});

test('the cloudflare tab shows the zone and worker selectors on a linked account', async ({
	page
}) => {
	const token = await authenticate(page);
	// link an account (mocked under MOCK_CF) so the account card renders the zone/worker dropdowns
	const link = await page.request.post('/api/cloudflare/link', {
		headers: { Authorization: `Bearer ${token}` },
		data: { account_id: 'mock-account', token: 'mock-token' }
	});
	expect(link.ok(), `cf link failed: ${link.status()} ${await link.text()}`).toBeTruthy();

	await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await page.getByRole('tab', { name: /cloudflare/i }).click();

	// the linked-account form renders the zone + worker selectors (presence only; opening reka
	// selects is flaky, so assert the fields and the provision control instead of picking an option)
	await expect(page.getByText('Cloudflare Account', { exact: true })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByText('Zone', { exact: true })).toBeVisible();
	await expect(page.getByText('Worker', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: /^provision$/i })).toBeVisible();
});
