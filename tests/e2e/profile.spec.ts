import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// authenticated staff profile page: the profile form (first/last/display/username/email + save +
// the first-name-required guard), the UserAvatarPicker (mode tabs + icon apply), and the
// UserLinkedMailboxes panel (link + unlink). logs in through the ui so the auth store hydrates
// currentUser (the form seeds from it), then grabs an api token for setup.

async function authenticate(page: import('@playwright/test').Page): Promise<string> {
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
	return await loginViaApi(page.request, TEST_ADMIN);
}

// the authenticated dashboard is heavy; local webkit hangs rendering it (not a product bug)
test.beforeEach(({ browserName }) => {
	test.skip(
		browserName === 'webkit',
		'authenticated dashboard rendering is flaky on local webkit; covered on desktop + mobile-pixel'
	);
});

test('the profile page renders the account fields, avatar picker, and linked mailboxes', async ({
	page
}) => {
	await authenticate(page);
	await page.goto('/dashboard/profile', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/profile/);

	await expect(page.getByRole('heading', { name: 'Your Profile', exact: true })).toBeVisible();

	// the account fields seed from the logged-in user once it resolves
	await expect(page.getByLabel('First Name', { exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByLabel('Last Name', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Display Name', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
	// two Email labels exist (profile + mailbox panel); the profile field is first in the dom
	await expect(page.getByLabel('Email', { exact: true }).first()).toBeVisible();

	// UserAvatarPicker + its apply control
	await expect(page.getByRole('button', { name: 'Apply Avatar' })).toBeVisible();

	// UserLinkedMailboxes panel
	await expect(page.getByRole('heading', { name: 'Linked Mailboxes', exact: true })).toBeVisible();
	await expect(page.getByPlaceholder('agent@example.com')).toBeVisible();
});

test('saving the profile shows the success toast', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/profile', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	const first = page.getByLabel('First Name', { exact: true });
	await expect(first).toBeVisible({ timeout: 30_000 });
	await first.fill('Casey');
	await page.getByRole('button', { name: 'Save Profile' }).click();
	await expect(page.getByText('Profile Saved', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('a last name without a first name trips the client-side guard', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/profile', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	const first = page.getByLabel('First Name', { exact: true });
	await expect(first).toBeVisible({ timeout: 30_000 });
	// clear any seeded first name, then add only a last name to trip saveProfile's refine
	await first.fill('');
	await page.getByLabel('Last Name', { exact: true }).fill('Rivera');
	await page.getByRole('button', { name: 'Save Profile' }).click();
	await expect(page.getByText('First Name Required', { exact: true })).toBeVisible({
		timeout: 30_000
	});
});

test('the avatar picker switches between upload, icon, and url modes', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/profile', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('button', { name: 'Apply Avatar' })).toBeVisible({ timeout: 30_000 });

	// the url tab reveals the image-url input
	await page.getByRole('tab', { name: 'URL', exact: true }).click();
	await expect(page.getByPlaceholder('https://...')).toBeVisible();

	// the icon tab reveals the iconify-name input
	await page.getByRole('tab', { name: 'Icon', exact: true }).click();
	await expect(page.getByPlaceholder('mdi:robot')).toBeVisible();
});

test('applying an icon avatar saves it', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/profile', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('button', { name: 'Apply Avatar' })).toBeVisible({ timeout: 30_000 });

	await page.getByRole('tab', { name: 'Icon', exact: true }).click();
	// a suggestion swatch's aria-label is the iconify name; clicking it enables Apply
	await page.getByRole('button', { name: 'mdi:robot', exact: true }).click();
	await page.getByRole('button', { name: 'Apply Avatar' }).click();
	// both the picker and the page fire an Avatar Updated toast; first() dodges the dup
	await expect(page.getByText('Avatar Updated', { exact: true }).first()).toBeVisible({
		timeout: 30_000
	});
});

test('linking and unlinking a mailbox updates the panel', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/profile', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	await expect(page.getByRole('heading', { name: 'Linked Mailboxes', exact: true })).toBeVisible({
		timeout: 30_000
	});

	const mailbox = `agent-${Date.now()}@smoke.test`;
	const emailInput = page.getByPlaceholder('agent@example.com');
	await emailInput.fill(mailbox);
	// settle-gate: the fill can beat the UInput v-model bind, leaving the submit button disabled
	await expect(emailInput).toHaveValue(mailbox);
	const link = page.getByRole('button', { name: 'Link Mailbox' });
	await expect(link).toBeEnabled();
	await link.click();
	await expect(page.getByText('Mailbox Linked', { exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(mailbox).first()).toBeVisible();

	// unlink it; the row disappears and the empty state returns
	await page.getByRole('button', { name: 'Unlink Mailbox' }).click();
	await expect(page.getByText('Mailbox Unlinked', { exact: true })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByText('No mailboxes linked yet.')).toBeVisible({ timeout: 30_000 });
});
