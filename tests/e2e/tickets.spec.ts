import { expect, test } from './fixtures';
import { loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// main lane: authenticated ticket lifecycle. logs in over the api (fast, no rate
// limiter) then plants the session_token cookie so ssr + client hydration both
// see the session. creates the customer/ticket via api, drives the ui for the rest.

async function authenticate(page: import('@playwright/test').Page, baseURL?: string) {
	const token = await loginViaApi(page.request, TEST_ADMIN);
	await page.context().addCookies([
		{
			name: 'session_token',
			value: token,
			url: baseURL ?? 'http://127.0.0.1:4000',
			sameSite: 'Lax'
		}
	]);
	return token;
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
	await page.getByRole('textbox', { name: /write a reply/i }).fill(reply);
	await page.getByRole('button', { name: /send reply/i }).click();

	await expect(page.getByText(reply)).toBeVisible({ timeout: 30_000 });
});

test('changing status and priority in the sidebar persists on reload', async ({
	page,
	baseURL
}) => {
	const token = await authenticate(page, baseURL);
	const customer = await createCustomer(page, token);
	const ticket = await createTicket(page, token, customer.id);

	await page.goto(`/dashboard/tickets/${ticket.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// status + priority are native USelect (real <select>) in the sidebar, wired to their labels
	await page.getByLabel('Status', { exact: true }).selectOption('work_in_progress');
	await page.getByLabel('Priority', { exact: true }).selectOption('high');

	// the badges in the header reflect the change
	await expect(page.getByText(/work in progress/i).first()).toBeVisible({ timeout: 30_000 });

	// and it survives a reload (the patch was written server-side)
	await page.reload({ waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByText(/work in progress/i).first()).toBeVisible();
	await expect(page.getByText(/high/i).first()).toBeVisible();
});
