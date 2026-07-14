import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// main lane: the customer portal. anonymous visitors get the otp login; a signed-in staffer is
// shown the "you're staff" notice instead of the customer view (no dead-end for staff). a magic
// link exchanges a token for a customer session and lands them in their request list.

async function authenticate(page: import('@playwright/test').Page) {
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
	return await loginViaApi(page.request, TEST_ADMIN);
}

async function apiPost(
	page: import('@playwright/test').Page,
	token: string,
	path: string,
	data: Record<string, unknown>
) {
	const res = await page.request.post(path, {
		headers: { Authorization: `Bearer ${token}` },
		data
	});
	expect(res.ok(), `${path} failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	return res.json();
}

test('the portal login renders for an anonymous visitor', async ({ page }) => {
	await page.context().clearCookies();
	await page.goto('/portal/login', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /customer portal/i })).toBeVisible();
	await expect(page.getByRole('textbox', { name: /email/i }).first()).toBeVisible();
});

test('visiting /portal anonymously redirects to the portal login', async ({ page }) => {
	await page.context().clearCookies();
	await page.goto('/portal', { waitUntil: 'domcontentloaded' });
	await expect(page).toHaveURL(/\/portal\/login/, { timeout: 30_000 });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /customer portal/i })).toBeVisible();
});

test('a signed-in staffer sees the staff notice on the portal', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'authenticated flows are flaky on local webkit');
	await page.context().clearCookies();
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

	await page.goto('/portal', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /signed in as staff/i })).toBeVisible();
	await expect(page.getByRole('link', { name: /dashboard/i }).first()).toBeVisible();
});

test('requesting a code on the portal login advances to the code-entry step', async ({ page }) => {
	await page.context().clearCookies();
	await page.goto('/portal/login', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// fill the email step and request a code; the otp is not deliverable offline, but the ui always
	// advances (the server 200s for any email so membership never leaks)
	await page.getByRole('textbox', { name: /email/i }).first().fill('portal-otp@smoke.test');
	await page.getByRole('button', { name: /send verification code/i }).click();

	// the code-entry step renders with the 6-digit field + the confirmation copy
	await expect(page.getByText(/we sent a 6-digit code/i)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('textbox', { name: /verification code/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /verify and continue/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /resend code/i })).toBeVisible();
});

test('a magic link signs a customer into the portal and lists their requests', async ({
	page,
	browserName
}) => {
	test.skip(browserName === 'webkit', 'authenticated flows are flaky on local webkit');
	const token = await authenticate(page);

	// seed a customer + a ticket for them, then mint a portal access link
	const email = `portal-magic-${Date.now()}@smoke.test`;
	const customer = (await apiPost(page, token, '/api/customers', {
		email,
		name: 'Portal Magic Customer'
	})) as { id: number };
	// public visibility so the customer's own reply renders on the shared status view (a private/
	// team-source ticket hides every message from the public page)
	const ticket = (await apiPost(page, token, '/api/tickets', {
		title: `Portal Magic Ticket ${Date.now()}`,
		description: 'seeded for the portal magic-link e2e',
		customer_id: customer.id,
		visibility: 'public'
	})) as { id: number; title: string };
	const magic = (await apiPost(page, token, `/api/customers/${customer.id}/magic-link`, {})) as {
		token: string;
	};

	// drop the staff session so the portal resolves the customer, not the staffer
	await page.context().clearCookies();

	await page.goto(`/portal/magic/${encodeURIComponent(magic.token)}`, {
		waitUntil: 'domcontentloaded'
	});
	// the token is exchanged for a customer session and redirects into the portal
	await expect(page).toHaveURL(/\/portal(\?|$)/, { timeout: 30_000 });
	await waitForHydration(page);

	// the request list renders with the seeded ticket
	await expect(page.getByRole('heading', { name: /^my requests$/i })).toBeVisible({
		timeout: 30_000
	});
	const ticketLink = page.getByRole('link', { name: new RegExp(ticket.title, 'i') });
	await expect(ticketLink).toBeVisible({ timeout: 30_000 });

	// open the request; the shared status/conversation view + the customer reply composer render
	await ticketLink.click();
	await expect(page).toHaveURL(/\/status\//, { timeout: 30_000 });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /request status/i })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByRole('heading', { name: new RegExp(ticket.title, 'i') })).toBeVisible();

	const composer = page.getByPlaceholder(/add more detail or reply to our team/i);
	await expect(composer).toBeVisible();
	const reply = `portal reply ${Date.now()}`;
	await composer.fill(reply);
	const sendBtn = page.getByRole('button', { name: /send reply/i });
	await expect(sendBtn).toBeEnabled();
	await sendBtn.click();
	await expect(page.getByText(reply)).toBeVisible({ timeout: 30_000 });
});
