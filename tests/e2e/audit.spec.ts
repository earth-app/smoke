import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// authenticated audit log: the UTable + filters render populated rows, and the export menu streams
// a download. an auditable action (a customer create) is triggered first so a row is guaranteed.

async function authenticate(page: import('@playwright/test').Page): Promise<string> {
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
	return await loginViaApi(page.request, TEST_ADMIN);
}

async function triggerAuditableAction(page: import('@playwright/test').Page, token: string) {
	const res = await page.request.post('/api/customers', {
		headers: { Authorization: `Bearer ${token}` },
		data: { email: `audit-${Date.now()}@smoke.test`, name: 'Audit Customer' }
	});
	expect(res.ok(), `customer create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test.beforeEach(({ browserName }) => {
	test.skip(
		browserName === 'webkit',
		'authenticated dashboard rendering is flaky on local webkit; covered on desktop + mobile-pixel'
	);
});

test('the audit table renders populated rows with the filters', async ({ page }) => {
	const token = await authenticate(page);
	await triggerAuditableAction(page, token);

	await page.goto('/dashboard/audit', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/audit/);

	await expect(page.getByRole('heading', { name: 'Audit Log', exact: true })).toBeVisible();
	// filter controls
	await expect(page.getByPlaceholder(/search summaries/i)).toBeVisible();
	// export controls
	await expect(page.getByRole('button', { name: 'Export as CSV' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Export as JSON' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Export as TXT' })).toBeVisible();

	// the customer-create action lands as a row
	await expect(page.getByText('Customer Created').first()).toBeVisible({ timeout: 30_000 });
});

test('the export menu streams a csv download', async ({ page }) => {
	const token = await authenticate(page);
	await triggerAuditableAction(page, token);

	await page.goto('/dashboard/audit', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('button', { name: 'Export as CSV' })).toBeVisible({
		timeout: 30_000
	});

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export as CSV' }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('audit.csv');
});

test('the export menu streams json and txt downloads', async ({ page, isMobile }) => {
	// two sequential downloads are unstable under emulated mobile; the json/txt branches are
	// verified on desktop (and the single csv download runs on mobile)
	test.skip(isMobile, 'sequential downloads are flaky on mobile; covered on desktop');
	const token = await authenticate(page);
	await triggerAuditableAction(page, token);

	await page.goto('/dashboard/audit', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('button', { name: 'Export as JSON' })).toBeVisible({
		timeout: 30_000
	});

	const jsonDownload = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export as JSON' }).click();
	expect((await jsonDownload).suggestedFilename()).toBe('audit.json');

	const txtDownload = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export as TXT' }).click();
	expect((await txtDownload).suggestedFilename()).toBe('audit.txt');
});

test('a no-match search shows the empty state and clear resets it', async ({ page }) => {
	const token = await authenticate(page);
	await triggerAuditableAction(page, token);

	await page.goto('/dashboard/audit', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByText('Customer Created').first()).toBeVisible({ timeout: 30_000 });

	// a search that matches nothing empties the table and reveals the clear control
	await page.getByPlaceholder(/search summaries/i).fill(`zzz-no-match-${Date.now()}`);
	await expect(page.getByText('No Audit Entries Found')).toBeVisible({ timeout: 30_000 });

	const clear = page.getByRole('button', { name: 'Clear', exact: true });
	await expect(clear).toBeVisible();
	await clear.click();
	// clearing the filters refetches and restores the rows
	await expect(page.getByText('Customer Created').first()).toBeVisible({ timeout: 30_000 });
});
