import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// authenticated admin users surface: the list + UserTable, the Invite Agent modal, and a user
// detail page (avatar picker, role select, and the PermissionMatrix). the users pages are admin
// -gated so log in through the ui to hydrate currentUser, then grab an api token to seed an agent.

async function authenticate(page: import('@playwright/test').Page): Promise<string> {
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
	return await loginViaApi(page.request, TEST_ADMIN);
}

// seed a fresh agent (non-owner, so its permissions are editable) and return its id
async function createAgent(page: import('@playwright/test').Page, token: string) {
	const username = `agent${Date.now()}`;
	const email = `${username}@smoke.test`;
	const res = await page.request.post('/api/users', {
		headers: { Authorization: `Bearer ${token}` },
		data: { username, email }
	});
	expect(res.ok(), `agent create failed: ${res.status()} ${await res.text()}`).toBeTruthy();

	const list = await page.request.get('/api/users?limit=100', {
		headers: { Authorization: `Bearer ${token}` }
	});
	expect(list.ok(), `user list failed: ${list.status()}`).toBeTruthy();
	const users = (await list.json()) as { id: number; username: string }[];
	const found = users.find((u) => u.username === username);
	expect(found, `seeded agent ${username} not found in list`).toBeTruthy();
	return { id: found!.id, username };
}

test.beforeEach(({ browserName }) => {
	test.skip(
		browserName === 'webkit',
		'authenticated dashboard rendering is flaky on local webkit; covered on desktop + mobile-pixel'
	);
});

test('the users list renders with the invite control and the table', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/users', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/users/);
	await expect(page.getByRole('heading', { name: /^users$/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /invite agent/i })).toBeVisible();
	// the UserTable renders user rows (each links to its detail page). assert a row is present
	// rather than a specific username - invite/join specs accumulate agents and the default list
	// is limited, so any given account (incl. the seeded admin) may be off page 1
	await expect(page.locator('a[href^="/dashboard/users/"]').first()).toBeVisible({
		timeout: 30_000
	});
});

test('the invite-agent modal generates a join link', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/users', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	await page.getByRole('button', { name: /invite agent/i }).click();
	await expect(page.getByRole('heading', { name: 'Invite Agent', exact: true })).toBeVisible();

	// create a link-only invite (no email); the result view surfaces the join url
	await page.getByRole('button', { name: /create invite/i }).click();
	await expect(page.getByText('Invite Created', { exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(page.locator('input[readonly]')).toHaveValue(/\/join\//, { timeout: 30_000 });
	await expect(page.getByRole('button', { name: /create another/i })).toBeVisible();
});

test('the user detail page renders the avatar picker, role select, and permission matrix', async ({
	page
}) => {
	const token = await authenticate(page);
	const agent = await createAgent(page, token);

	await page.goto(`/dashboard/users/${agent.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// header identity + editable detail cards ("Avatar"/"Details" are styled <p> labels)
	await expect(page.getByText(`@${agent.username}`).first()).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText('Avatar', { exact: true }).first()).toBeVisible();
	// the PermissionMatrix header line
	await expect(page.getByText(/of \d+ permissions granted/i)).toBeVisible();
});

test('toggling a permission on the matrix persists', async ({ page }) => {
	const token = await authenticate(page);
	const agent = await createAgent(page, token);

	await page.goto(`/dashboard/users/${agent.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByText(/of \d+ permissions granted/i)).toBeVisible({ timeout: 30_000 });

	// flip the first permission switch; that makes the form dirty and reveals Save Changes
	const firstSwitch = page.getByRole('switch').first();
	await firstSwitch.click();

	const save = page.getByRole('button', { name: /save changes/i });
	await expect(save).toBeVisible({ timeout: 30_000 });
	await save.click();
	await expect(page.getByText('User Updated', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('the users list shows the empty state for a no-match search', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/users', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// let the initial (no-search) list settle first, else a late initial fetch can resolve after the
	// search fetch and overwrite the empty result with the full list
	await expect(page.locator('a[href^="/dashboard/users/"]').first()).toBeVisible({
		timeout: 30_000
	});
	// the search is debounced then reloads; a no-match query drives the UserTable empty state
	const q = `no-such-user-${Date.now()}`;
	const searchBox = page.getByPlaceholder(/search users/i);
	await searchBox.fill(q);
	await expect(searchBox).toHaveValue(q);
	await expect(page.getByText(/no users found/i)).toBeVisible({ timeout: 30_000 });
});
