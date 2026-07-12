import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// main lane: authenticated ticket lifecycle. logs in through the ui so the auth
// store hydrates currentUser (drives permission-gated ui like the composer), and
// grabs an api token for the customer/ticket setup. drives the ui for the rest.

async function authenticate(page: import('@playwright/test').Page, _baseURL?: string) {
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
	return await loginViaApi(page.request, TEST_ADMIN);
}

async function createCustomer(page: import('@playwright/test').Page, token: string) {
	const email = `cust-${Date.now()}@smoke.test`;
	const res = await page.request.post('/api/customers', {
		headers: { Authorization: `Bearer ${token}` },
		data: { email, name: 'E2E Customer' }
	});
	expect(res.ok(), `customer create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	return (await res.json()) as { id: number; email: string };
}

async function createTicket(
	page: import('@playwright/test').Page,
	token: string,
	customerId: number
) {
	const res = await page.request.post('/api/tickets', {
		headers: { Authorization: `Bearer ${token}` },
		data: {
			title: `E2E Ticket ${Date.now()}`,
			description: 'created by the tickets e2e spec',
			customer_id: customerId
		}
	});
	expect(res.ok(), `ticket create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	return (await res.json()) as { id: number; title: string };
}

// the authenticated dashboard is heavy; local webkit hangs rendering it (not a product
// bug - it passes on desktop chromium + mobile chrome). scope these to non-webkit
test.beforeEach(({ browserName }) => {
	test.skip(
		browserName === 'webkit',
		'authenticated dashboard rendering is flaky on local webkit; covered on desktop + mobile-pixel'
	);
});

test('the tickets list renders with the new-ticket control', async ({ page, baseURL }) => {
	await authenticate(page, baseURL);
	await page.goto('/dashboard/tickets', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/tickets/);
	await expect(page.getByRole('heading', { name: /^tickets$/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /new ticket/i })).toBeVisible();
});

test('opening the new-ticket modal shows the create form', async ({ page, baseURL }) => {
	const token = await authenticate(page, baseURL);
	await createCustomer(page, token);

	await page.goto('/dashboard/tickets', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await page.getByRole('button', { name: /new ticket/i }).click();

	// modal content: the New Ticket header + a title field + a create button
	await expect(page.getByRole('heading', { name: /new ticket/i })).toBeVisible();
	await expect(page.getByRole('textbox', { name: /title/i }).first()).toBeVisible();
	await expect(page.getByRole('button', { name: /create ticket/i })).toBeVisible();
});

test('replying through the composer appends the message to the thread', async ({
	page,
	baseURL
}) => {
	const token = await authenticate(page, baseURL);
	const customer = await createCustomer(page, token);
	const ticket = await createTicket(page, token, customer.id);

	await page.goto(`/dashboard/tickets/${ticket.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: new RegExp(ticket.title, 'i') })).toBeVisible();

	const reply = `automated reply ${Date.now()}`;
	await page.getByPlaceholder(/write a reply/i).fill(reply);
	await page.getByRole('button', { name: /send reply/i }).click();

	await expect(page.getByText(reply)).toBeVisible({ timeout: 30_000 });
});

test('changing status and priority in the sidebar persists on reload', async ({
	page,
	baseURL,
	isMobile
}) => {
	// reka select renders its options in a portal; the option click is unreliable on
	// mobile webkit (pointer-intercept), so this interaction is verified on desktop
	test.skip(isMobile, 'reka select option clicks are flaky on mobile; covered on desktop');
	const token = await authenticate(page, baseURL);
	const customer = await createCustomer(page, token);
	const ticket = await createTicket(page, token, customer.id);

	await page.goto(`/dashboard/tickets/${ticket.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// status + priority are reka USelect comboboxes; open each and click the option. assert each
	// change landed before touching the next select so the portal dropdown fully closes + the patch
	// settles (avoids a pointer-intercept race between the two selects)
	await page.getByLabel('Status', { exact: true }).click();
	await page.getByRole('option', { name: /work in progress/i }).click();
	await expect(page.getByText(/work in progress/i).first()).toBeVisible({ timeout: 30_000 });

	await page.getByLabel('Priority', { exact: true }).click();
	await page.getByRole('option', { name: /^high$/i }).click();
	await expect(page.getByText(/high/i).first()).toBeVisible({ timeout: 30_000 });

	// and it survives a reload (the patch was written server-side)
	await page.reload({ waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByText(/work in progress/i).first()).toBeVisible();
	await expect(page.getByText(/high/i).first()).toBeVisible();
});

test('an archived ticket shows the staff deletion-countdown banner', async ({
	page,
	baseURL,
	isMobile
}) => {
	// the staff dashboard detail view is heavy; verified on desktop (mobile hangs the nav under load)
	test.skip(isMobile, 'staff dashboard is heavy on mobile; the banner is verified on desktop');
	const token = await authenticate(page, baseURL);
	// a delete window makes the countdown banner meaningful (default is never-delete = no banner)
	const settings = await page.request.post('/api/settings', {
		headers: { Authorization: `Bearer ${token}` },
		data: { retention: { delete_days: 90 } }
	});
	expect(
		settings.ok(),
		`settings failed: ${settings.status()} ${await settings.text()}`
	).toBeTruthy();

	const customer = await createCustomer(page, token);
	const ticket = await createTicket(page, token, customer.id);
	const patch = await page.request.patch(`/api/tickets/${ticket.id}`, {
		headers: { Authorization: `Bearer ${token}` },
		data: { archived: true }
	});
	expect(patch.ok(), `archive failed: ${patch.status()} ${await patch.text()}`).toBeTruthy();

	await page.goto(`/dashboard/tickets/${ticket.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	// the archived ticket renders and the staff-only deletion banner is shown
	await expect(page.getByRole('heading', { name: new RegExp(ticket.title, 'i') })).toBeVisible();
	await expect(page.getByText(/delet/i).first()).toBeVisible({ timeout: 30_000 });
});

test('adds and removes a ticket participant in the sidebar panel', async ({
	page,
	baseURL,
	isMobile
}) => {
	// the staff ticket detail sidebar is heavy; verified on desktop (mobile hangs the nav under load)
	test.skip(
		isMobile,
		'staff ticket detail sidebar is heavy on mobile; participants verified on desktop'
	);
	const token = await authenticate(page, baseURL);
	const customer = await createCustomer(page, token);
	const ticket = await createTicket(page, token, customer.id);

	await page.goto(`/dashboard/tickets/${ticket.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: new RegExp(ticket.title, 'i') })).toBeVisible();

	// the participants panel + its add-email control render in the sidebar
	await expect(page.getByText(/people on this ticket/i)).toBeVisible();
	const emailInput = page.getByPlaceholder('name@example.com');
	await expect(emailInput).toBeVisible();

	// add a participant; the live :4000 backend runs the POST (the invite send best-effort no-ops offline)
	const participant = `ccperson-t${ticket.id}@smoke.test`;
	await emailInput.fill(participant);
	await page
		.locator('form', { has: page.getByPlaceholder('name@example.com') })
		.getByRole('button', { name: 'Add', exact: true })
		.click();

	// the new participant row + its remove control show up after the refetch
	const removeButton = page.getByRole('button', { name: 'Remove Email' });
	await expect(removeButton).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(participant).first()).toBeVisible();

	// remove it; the row disappears
	await removeButton.click();
	await expect(page.getByRole('button', { name: 'Remove Email' })).toHaveCount(0, {
		timeout: 30_000
	});
});
