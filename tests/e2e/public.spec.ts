import { expect, test } from './fixtures';
import { loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// main lane, no auth: the public request funnel (landing -> submit -> status).

test('the landing page renders and links to the submit flow', async ({ page }) => {
	await page.goto('/', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	const submit = page.getByRole('link', { name: /submit a request/i }).first();
	await expect(submit).toBeVisible();
	await submit.click();
	await expect(page).toHaveURL(/\/submit/);
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: /submit a request/i })).toBeVisible();
});

test('submitting the public form yields a ticket id and a working track link', async ({ page }) => {
	await page.goto('/submit', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	await page.getByLabel(/^email$/i).fill(`public-${Date.now()}@smoke.test`);
	await page.getByLabel(/^subject$/i).fill('E2E public request');
	await page.getByLabel(/^description$/i).fill('submitted by the public e2e spec');
	await page.getByRole('button', { name: /submit request/i }).click();

	// success card shows the ticket id and a track button (scope to the card's own line: the
	// "My Requests" list below also carries "#<id>" once a request has been tracked)
	await expect(page.getByText(/request received/i)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(/your ticket id is #\d+/i)).toBeVisible();
	const track = page.getByRole('link', { name: /track your request/i });
	await expect(track).toBeVisible();

	await track.click();
	await expect(page).toHaveURL(/\/status\//);
	await waitForHydration(page);

	// the status page renders the request-status header, the ticket title, and its id
	await expect(page.getByRole('heading', { name: /request status/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /e2e public request/i })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByText(/#\d+/).first()).toBeVisible();
});

test('an unknown status token shows the not-found card', async ({ page }) => {
	await page.goto('/status/not-a-real-token?id=999999999', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByText(/request not found/i)).toBeVisible({ timeout: 30_000 });
});

test('the status viewer renders the conversation and accepts a reply', async ({ page }) => {
	// open a public request via the unauthenticated api so it carries a status token + a real customer
	const email = `status-${Date.now()}@smoke.test`;
	const create = await page.request.post('/api/public/tickets', {
		data: {
			email,
			title: `Status Viewer ${Date.now()}`,
			description: 'seeded for the status-viewer e2e',
			// the test env runs turnstile's always-pass key; any non-empty token clears the gate
			turnstile: 'e2e-token'
		}
	});
	expect(
		create.ok(),
		`ticket create failed: ${create.status()} ${await create.text()}`
	).toBeTruthy();
	const { ticket_id, status_token } = (await create.json()) as {
		ticket_id: number;
		status_token: string;
	};

	await page.goto(`/status/${encodeURIComponent(status_token)}?id=${ticket_id}`, {
		waitUntil: 'domcontentloaded'
	});
	await waitForHydration(page);

	// TicketConversation renders the header, description, and the conversation section
	await expect(page.getByRole('heading', { name: /request status/i })).toBeVisible();
	await expect(page.getByText(/seeded for the status-viewer e2e/i)).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByRole('heading', { name: /^conversation$/i })).toBeVisible();

	// the token holder can reply; the send is accepted (a guest ticket defaults to private
	// visibility, so its messages are filtered from the public view - assert the accept toast)
	const composer = page.getByPlaceholder(/add more detail or reply to our team/i);
	await expect(composer).toBeVisible();
	await composer.fill(`status reply ${Date.now()}`);
	const sendBtn = page.getByRole('button', { name: /send reply/i });
	await expect(sendBtn).toBeEnabled();
	await sendBtn.click();
	await expect(page.getByText('Reply Sent', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('the public search page browses and filters requests', async ({ page }) => {
	await page.goto('/search', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// the page chrome: heading, the open/archived tabs, and the search input
	await expect(page.getByRole('heading', { name: /search requests/i })).toBeVisible();
	await expect(page.getByRole('tab', { name: /open/i })).toBeVisible();
	await expect(page.getByRole('tab', { name: /archived/i })).toBeVisible();
	const input = page.getByPlaceholder(/search public requests/i);
	await expect(input).toBeVisible();

	// a query with no match drives the debounced search + the empty-result branch
	await input.fill(`no-such-request-${Date.now()}`);
	await expect(page.getByText(/no tickets found/i)).toBeVisible({ timeout: 30_000 });

	// switching to the archived tab re-runs the search and swaps the placeholder (a distinct browse)
	await page.getByRole('tab', { name: /archived/i }).click();
	await expect(page.getByPlaceholder(/search archived requests/i)).toBeVisible({ timeout: 30_000 });
});

test('a locked request hides the reply composer on the status page', async ({ page }) => {
	// locking needs a staff token; drive it over the api, then view the public page as the customer
	const token = await loginViaApi(page.request, TEST_ADMIN);
	const email = `locked-${Date.now()}@smoke.test`;
	const create = await page.request.post('/api/public/tickets', {
		data: {
			email,
			title: `Locked Request ${Date.now()}`,
			description: 'seeded for the locked-reply e2e',
			turnstile: 'e2e-token'
		}
	});
	expect(
		create.ok(),
		`ticket create failed: ${create.status()} ${await create.text()}`
	).toBeTruthy();
	const { ticket_id, status_token } = (await create.json()) as {
		ticket_id: number;
		status_token: string;
	};

	const lock = await page.request.post(`/api/tickets/${ticket_id}/lock`, {
		headers: { Authorization: `Bearer ${token}` },
		data: { locked: true }
	});
	expect(lock.ok(), `lock failed: ${lock.status()} ${await lock.text()}`).toBeTruthy();

	// drop the staff session so the page renders the customer view
	await page.context().clearCookies();
	await page.goto(`/status/${encodeURIComponent(status_token)}?id=${ticket_id}`, {
		waitUntil: 'domcontentloaded'
	});
	await waitForHydration(page);

	// the conversation shows the locked alert and the reply composer is gone (canReply is false)
	await expect(page.getByText(/this request is locked/i)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByPlaceholder(/add more detail or reply to our team/i)).toHaveCount(0);
});
