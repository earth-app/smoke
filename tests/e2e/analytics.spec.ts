import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// the dashboard overview renders <AnalyticsDashboard> (admins + ManageTicket). seed a couple of
// tickets so the summary has data, then assert the KPI cards + the sparkline/bar-chart widgets.

async function authenticate(page: import('@playwright/test').Page): Promise<string> {
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
	return await loginViaApi(page.request, TEST_ADMIN);
}

async function seedTickets(page: import('@playwright/test').Page, token: string) {
	const cust = await page.request.post('/api/customers', {
		headers: { Authorization: `Bearer ${token}` },
		data: { email: `analytics-${Date.now()}@smoke.test`, name: 'Analytics Customer' }
	});
	expect(cust.ok(), `customer failed: ${cust.status()} ${await cust.text()}`).toBeTruthy();
	const customer = (await cust.json()) as { id: number };

	for (let i = 0; i < 2; i++) {
		const res = await page.request.post('/api/tickets', {
			headers: { Authorization: `Bearer ${token}` },
			data: {
				title: `Analytics Ticket ${Date.now()}-${i}`,
				description: 'seeded for the analytics e2e spec',
				customer_id: customer.id
			}
		});
		expect(res.ok(), `ticket failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	}
}

test.beforeEach(({ browserName }) => {
	test.skip(
		browserName === 'webkit',
		'authenticated dashboard rendering is flaky on local webkit; covered on desktop + mobile-pixel'
	);
});

test('the overview renders the analytics KPIs and charts', async ({ page }) => {
	const token = await authenticate(page);
	await seedTickets(page, token);

	await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard$/);

	// page chrome + quick cards
	await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();

	// analytics dashboard header + KPI labels
	await expect(page.getByRole('heading', { name: 'Ticket Analytics', exact: true })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByText('Total Tickets', { exact: true })).toBeVisible();
	await expect(page.getByText('Email Share', { exact: true })).toBeVisible();

	// the chart cards render (sparkline + bar charts)
	await expect(page.getByRole('heading', { name: 'Ticket Volume', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'By Status', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'By Priority', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Channel Mix', exact: true })).toBeVisible();
});
