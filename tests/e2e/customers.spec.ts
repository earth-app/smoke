import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// authenticated staff customers surface: list + New Customer modal, the detail page (CustomerCard,
// recent tickets), and the portal magic-link generator. logs in through the ui so the auth store
// hydrates currentUser (the manage-customers controls are permission-gated), then grabs an api token.

async function authenticate(page: import('@playwright/test').Page): Promise<string> {
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
	return await loginViaApi(page.request, TEST_ADMIN);
}

async function createCustomer(page: import('@playwright/test').Page, token: string) {
	const email = `cust-${Date.now()}@smoke.test`;
	const res = await page.request.post('/api/customers', {
		headers: { Authorization: `Bearer ${token}` },
		data: { email, name: 'Detail Customer' }
	});
	expect(res.ok(), `customer create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	return (await res.json()) as { id: number; email: string; name?: string };
}

// the authenticated dashboard is heavy; local webkit hangs rendering it (not a product bug)
test.beforeEach(({ browserName }) => {
	test.skip(
		browserName === 'webkit',
		'authenticated dashboard rendering is flaky on local webkit; covered on desktop + mobile-pixel'
	);
});

test('the customers list renders with the new-customer control', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/customers', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/customers/);
	await expect(page.getByRole('heading', { name: /^customers$/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /new customer/i })).toBeVisible();
	await expect(page.getByPlaceholder(/search customers/i)).toBeVisible();
});

test('creating a customer through the modal adds it to the list', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/customers', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	await page.getByRole('button', { name: /new customer/i }).click();
	await expect(page.getByRole('heading', { name: /new customer/i })).toBeVisible();

	const name = `Modal Customer ${Date.now()}`;
	await page.getByPlaceholder('Jane Doe').fill(name);
	await page.getByPlaceholder('jane@example.com').fill(`modal-${Date.now()}@smoke.test`);
	await page.getByRole('button', { name: /create customer/i }).click();

	await expect(page.getByText('Customer Created', { exact: true })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
});

test('the customer detail page renders the card, portal access, and recent tickets', async ({
	page
}) => {
	const token = await authenticate(page);
	const customer = await createCustomer(page, token);

	await page.goto(`/dashboard/customers/${customer.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// CustomerCard shows the customer email; the portal + recent-tickets panels render
	await expect(page.getByText(customer.email).first()).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('heading', { name: 'Portal Access', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Recent Tickets', exact: true })).toBeVisible();
});

test('generate access link mints a portal magic link', async ({ page }) => {
	const token = await authenticate(page);
	const customer = await createCustomer(page, token);

	await page.goto(`/dashboard/customers/${customer.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	const generate = page.getByRole('button', { name: /generate access link/i });
	await expect(generate).toBeVisible({ timeout: 30_000 });
	await generate.click();

	// the minted link surfaces in the readonly input (a /portal/magic/ url)
	await expect(page.locator('input[readonly]')).toHaveValue(/\/portal\/magic\//, {
		timeout: 30_000
	});
});

test('the customers list shows the empty state for a no-match search', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/customers', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// a query with no match drives the debounced search + the empty-result branch
	await page.getByPlaceholder(/search customers/i).fill(`no-such-customer-${Date.now()}`);
	await expect(page.getByText(/no customers found/i)).toBeVisible({ timeout: 30_000 });
});

test('the edit-tags modal saves customer tags', async ({ page }) => {
	const token = await authenticate(page);
	const customer = await createCustomer(page, token);

	await page.goto(`/dashboard/customers/${customer.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByText(customer.email).first()).toBeVisible({ timeout: 30_000 });

	// open the edit-tags modal from the customer card and save (no tags selected still persists)
	await page.getByRole('button', { name: 'Edit Tags' }).click();
	await expect(page.getByRole('heading', { name: 'Edit Tags', exact: true })).toBeVisible();
	await page.getByRole('button', { name: /save tags/i }).click();
	await expect(page.getByText('Tags Updated', { exact: true })).toBeVisible({ timeout: 30_000 });
});
