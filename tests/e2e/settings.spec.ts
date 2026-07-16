import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// main lane: authenticated admin settings. logs in through the ui so the auth store hydrates
// currentUser (the settings page is admin-gated), then drives the email + cloudflare tabs.

async function authenticate(page: import('@playwright/test').Page): Promise<string> {
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
	return await loginViaApi(page.request, TEST_ADMIN);
}

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

	// the security card (turnstile bot protection) renders on the same tab
	await expect(page.getByText('Bot Protection', { exact: true })).toBeVisible();
});

test('the branding tab saves the instance name', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// branding is the default tab; the branding form + role icon/color cards render under it
	await expect(page.getByRole('tab', { name: /branding/i })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByRole('heading', { name: 'Branding', exact: true })).toBeVisible();

	const name = `Smoke E2E ${Date.now()}`;
	await page.getByLabel('Name', { exact: true }).fill(name);
	await page.getByRole('button', { name: /save branding/i }).click();
	await expect(page.getByText('Branding Saved', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('the branding tab saves role icons and role colors', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// role icons: type an iconify name into the agent field (unique by its placeholder) and save
	await expect(page.getByRole('heading', { name: 'Role Icons', exact: true })).toBeVisible();
	await page.getByPlaceholder('mdi:account', { exact: true }).fill('mdi:face-agent');
	await page.getByRole('button', { name: /save role icons/i }).click();
	await expect(page.getByText('Role Icons Saved', { exact: true })).toBeVisible({
		timeout: 30_000
	});

	// role colors: the card renders per-role avatar previews + color selects; persist the defaults
	await expect(page.getByRole('heading', { name: 'Role Colors', exact: true })).toBeVisible();
	await page.getByRole('button', { name: /save role colors/i }).click();
	await expect(page.getByText('Role Colors Saved', { exact: true })).toBeVisible({
		timeout: 30_000
	});
});

test('role icon field loads its saved value without any interaction', async ({ page }) => {
	const token = await authenticate(page);

	const icon = `mdi:star-${Date.now() % 100000}`;
	const res = await page.request.post('/api/settings', {
		headers: { Authorization: `Bearer ${token}` },
		data: { role_icons: { agent: icon } }
	});
	expect(res.ok(), `settings save failed: ${res.status()} ${await res.text()}`).toBeTruthy();

	await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// no clicks: the agent role-icon input (unique by placeholder) shows the saved value on load
	await expect(page.getByPlaceholder('mdi:account', { exact: true })).toHaveValue(icon, {
		timeout: 15_000
	});
});

test('the automation tab creates a flow with a nested condition group', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	await page.getByRole('tab', { name: /automation/i }).click();
	await expect(page.getByRole('heading', { name: 'Automation Flows', exact: true })).toBeVisible();

	// open the editor modal
	await page.getByRole('button', { name: 'New Flow' }).click();
	await expect(page.getByRole('heading', { name: 'New Flow', exact: true })).toBeVisible();

	const flowName = `Escalate ${Date.now()}`;
	await page.getByPlaceholder('Escalate Urgent Tickets').fill(flowName);

	// drive the recursive FlowConditionGroup builder: add a leaf condition, then a nested group
	await page.getByRole('button', { name: 'Add Condition' }).first().click();
	await expect(page.getByRole('button', { name: 'Remove Condition' })).toBeVisible();
	await page.getByPlaceholder('Value to compare against').fill('refund');

	await page.getByRole('button', { name: 'Add Group' }).first().click();
	// the nested group renders its own remove control + a second Add Condition button
	await expect(page.getByRole('button', { name: 'Remove Group' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add Condition' })).toHaveCount(2);

	// the default action (set priority) satisfies the min-one-action rule; save
	await page.getByRole('button', { name: 'Create Flow' }).click();
	await expect(page.getByText('Flow Created', { exact: true })).toBeVisible({ timeout: 30_000 });
	// the new flow shows up in the list
	await expect(page.getByText(flowName).first()).toBeVisible({ timeout: 30_000 });
});

test('the audit tab saves the retention window', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	await page.getByRole('tab', { name: /audit/i }).click();
	await expect(
		page.getByRole('heading', { name: 'Audit Log Retention', exact: true })
	).toBeVisible();

	await page.getByLabel('Keep Entries For (Days)', { exact: true }).fill('45');
	await page.getByRole('button', { name: /save audit settings/i }).click();
	await expect(page.getByText('Audit Settings Saved', { exact: true })).toBeVisible({
		timeout: 30_000
	});
});

test('the visibility, projects, custom fields, ai, and retention tabs render their content', async ({
	page,
	browserName
}) => {
	test.skip(browserName === 'webkit', 'authenticated dashboard rendering is flaky on local webkit');
	await authenticate(page);
	await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// each tab click mounts a settings sub-component; assert a distinctive control from each. only the
	// active panel is shown, so a per-tab unique button is a stable, strict-mode-safe target
	await page.getByRole('tab', { name: /visibility/i }).click();
	await expect(page.getByText('Default Ticket Visibility', { exact: true })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByRole('button', { name: /save visibility/i })).toBeVisible();

	await page.getByRole('tab', { name: /projects/i }).click();
	await expect(page.getByRole('button', { name: /add project/i })).toBeVisible({ timeout: 30_000 });

	await page.getByRole('tab', { name: /custom fields/i }).click();
	await expect(page.getByRole('button', { name: /save fields/i })).toBeVisible({ timeout: 30_000 });

	await page.getByRole('tab', { name: /ai replies/i }).click();
	await expect(page.getByRole('button', { name: /save ai settings/i })).toBeVisible({
		timeout: 30_000
	});

	await page.getByRole('tab', { name: /retention/i }).click();
	await expect(page.getByRole('button', { name: /save retention/i })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByText('Thread Locking', { exact: true })).toBeVisible();
});
