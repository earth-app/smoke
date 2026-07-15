import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// main lane: authenticated ticket lifecycle. logs in through the ui so the auth
// store hydrates currentUser (drives permission-gated ui like the composer), and
// grabs an api token for the customer/ticket setup. drives the ui for the rest.

async function authenticate(page: import('@playwright/test').Page, _baseURL?: string) {
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
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

// create a public (guest) ticket via the unauthenticated api; returns the hmac status token so the
// public status page can be driven the way a customer reaches it
async function createPublicTicket(page: import('@playwright/test').Page) {
	const email = `guest-${Date.now()}@smoke.test`;
	const res = await page.request.post('/api/public/tickets', {
		data: {
			email,
			title: `Guest Ticket ${Date.now()}`,
			description: 'created by the tickets e2e spec',
			// the test env runs turnstile's always-pass key; any non-empty token clears the gate
			turnstile: 'e2e-token'
		}
	});
	expect(res.ok(), `public ticket create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	return (await res.json()) as { ticket_id: number; status_token: string };
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

test('creating a label inline in the sidebar picker attaches it to the ticket', async ({
	page,
	baseURL,
	isMobile
}) => {
	// the label picker is a reka USelectMenu; its option click is unreliable on mobile, and the
	// staff detail sidebar is heavy there, so this is verified on desktop
	test.skip(isMobile, 'reka select-menu option clicks are flaky on mobile; covered on desktop');
	const token = await authenticate(page, baseURL);
	const customer = await createCustomer(page, token);
	const ticket = await createTicket(page, token, customer.id);

	await page.goto(`/dashboard/tickets/${ticket.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: new RegExp(ticket.title, 'i') })).toBeVisible();

	// open the "Labels" TicketLabelPicker (a reka USelectMenu combobox) via its placeholder, type a
	// fresh name, and pick the "Create label" option; the picker auto-creates + selects it
	const labelName = `Picked ${Date.now()}`;
	await page.getByText('Add labels').click();
	await page.getByRole('combobox', { name: 'Search…' }).fill(labelName);
	await page.getByRole('option', { name: /create label/i }).click();

	// the picker creates the label (toast) and shows its badge in the sidebar
	await expect(page.getByText('Label Created', { exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(labelName).first()).toBeVisible({ timeout: 30_000 });
});

test('the timeline renders the created and status-change events', async ({
	page,
	baseURL,
	isMobile
}) => {
	// the staff detail conversation is heavy on mobile; timeline events are verified on desktop
	test.skip(isMobile, 'staff detail view is heavy on mobile; timeline verified on desktop');
	const token = await authenticate(page, baseURL);
	const customer = await createCustomer(page, token);
	const ticket = await createTicket(page, token, customer.id);
	// a status patch emits a 'status' timeline event alongside the 'created' one
	const patch = await page.request.patch(`/api/tickets/${ticket.id}`, {
		headers: { Authorization: `Bearer ${token}` },
		data: { status: 'work_in_progress' }
	});
	expect(patch.ok(), `status patch failed: ${patch.status()} ${await patch.text()}`).toBeTruthy();

	await page.goto(`/dashboard/tickets/${ticket.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: new RegExp(ticket.title, 'i') })).toBeVisible();

	// TicketEvent rows interleave in the thread: the opened event + the status change
	await expect(page.getByText(/opened this request/i)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(/changed status/i).first()).toBeVisible({ timeout: 30_000 });
});

test('a custom field renders in the sidebar and saves its value', async ({
	page,
	baseURL,
	isMobile
}) => {
	// the staff ticket detail sidebar is heavy; verified on desktop (mobile hangs the nav under load)
	test.skip(
		isMobile,
		'staff ticket detail sidebar is heavy on mobile; custom fields verified on desktop'
	);
	const token = await authenticate(page, baseURL);
	// define a single text custom field (the post replaces the whole global set)
	const define = await page.request.post('/api/custom-fields', {
		headers: { Authorization: `Bearer ${token}` },
		data: { fields: [{ label: 'Order Number', type: 'text' }] }
	});
	expect(
		define.ok(),
		`custom-field define failed: ${define.status()} ${await define.text()}`
	).toBeTruthy();

	try {
		const customer = await createCustomer(page, token);
		const ticket = await createTicket(page, token, customer.id);

		await page.goto(`/dashboard/tickets/${ticket.id}`, { waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByRole('heading', { name: new RegExp(ticket.title, 'i') })).toBeVisible();

		// the sidebar custom-fields panel + the text editor render from the global definition
		await expect(page.getByText('Custom Fields', { exact: true })).toBeVisible({ timeout: 30_000 });
		const field = page.getByLabel('Order Number', { exact: true });
		await expect(field).toBeVisible({ timeout: 30_000 });

		// setting a value patches the ticket (the success toast confirms the round-trip)
		await field.fill('ORD-4242');
		await expect(page.getByText('Ticket Updated', { exact: true })).toBeVisible({
			timeout: 30_000
		});

		// and it survives a reload (the value was written server-side)
		await page.reload({ waitUntil: 'domcontentloaded' });
		await waitForHydration(page);
		await expect(page.getByLabel('Order Number', { exact: true })).toHaveValue('ORD-4242', {
			timeout: 30_000
		});
	} finally {
		// reset the global definition so other specs see a clean slate
		await page.request
			.post('/api/custom-fields', {
				headers: { Authorization: `Bearer ${token}` },
				data: { fields: [] }
			})
			.catch(() => {});
	}
});

test('a closed request shows the reopen control on the status page', async ({ page }) => {
	const token = await loginViaApi(page.request, TEST_ADMIN);
	// customer reopen defaults on; set it explicitly so a prior test can't leave it disabled
	const settings = await page.request.post('/api/settings', {
		headers: { Authorization: `Bearer ${token}` },
		data: { locking: { customer_reopen: true } }
	});
	expect(
		settings.ok(),
		`settings failed: ${settings.status()} ${await settings.text()}`
	).toBeTruthy();

	const { ticket_id, status_token } = await createPublicTicket(page);
	// close it so the reopen control becomes eligible (canReopen needs a closed/archived request)
	const patch = await page.request.patch(`/api/tickets/${ticket_id}`, {
		headers: { Authorization: `Bearer ${token}` },
		data: { status: 'closed' }
	});
	expect(patch.ok(), `close failed: ${patch.status()} ${await patch.text()}`).toBeTruthy();

	// view the public status page the way a customer does (drop the staff session)
	await page.context().clearCookies();
	await page.goto(`/status/${encodeURIComponent(status_token)}?id=${ticket_id}`, {
		waitUntil: 'domcontentloaded'
	});
	await waitForHydration(page);

	const reopen = page.getByRole('button', { name: /reopen request/i });
	await expect(reopen).toBeVisible({ timeout: 30_000 });
	await reopen.click();

	// the reopen succeeds and surfaces the confirmation toast
	await expect(page.getByText('Request Reopened', { exact: true })).toBeVisible({
		timeout: 30_000
	});
});

test('the message composer toggles markdown preview and the cc field', async ({
	page,
	baseURL
}) => {
	const token = await authenticate(page, baseURL);
	const customer = await createCustomer(page, token);
	const ticket = await createTicket(page, token, customer.id);

	await page.goto(`/dashboard/tickets/${ticket.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: new RegExp(ticket.title, 'i') })).toBeVisible();

	const editor = page.getByPlaceholder(/write a reply/i);
	await expect(editor).toBeVisible();

	// the Bold toolbar button wraps the (empty) selection with markdown markers
	await page.getByRole('button', { name: 'Bold', exact: true }).click();
	await expect(editor).toHaveValue('****');

	// typing + Preview swaps the textarea for the rendered markdown; the toggle label flips to Edit
	await editor.fill('hello **world**');
	await page.getByRole('button', { name: /^preview$/i }).click();
	await expect(page.getByRole('button', { name: /^edit$/i })).toBeVisible();
	await page.getByRole('button', { name: /^edit$/i }).click();
	await expect(page.getByRole('button', { name: /^preview$/i })).toBeVisible();

	// the Cc toggle reveals the carbon-copy field
	await page.getByRole('button', { name: 'Cc', exact: true }).click();
	await expect(page.getByPlaceholder('name@example.com, another@example.com')).toBeVisible();
});

test('editing a posted message records an edit history', async ({ page, baseURL }) => {
	const token = await authenticate(page, baseURL);
	const customer = await createCustomer(page, token);
	const ticket = await createTicket(page, token, customer.id);

	await page.goto(`/dashboard/tickets/${ticket.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	const original = `edit target ${Date.now()}`;
	await page.getByPlaceholder(/write a reply/i).fill(original);
	await page.getByRole('button', { name: /send reply/i }).click();
	await expect(page.getByText(original)).toBeVisible({ timeout: 30_000 });

	// open the inline editor on the message (admin can edit any message), change it, save
	await page.getByRole('button', { name: 'Edit Message' }).click();
	const save = page.getByRole('button', { name: 'Save', exact: true });
	await expect(save).toBeVisible({ timeout: 30_000 });
	// the inline edit textarea carries no placeholder; the composer does, so this excludes it
	const editBox = page.locator('textarea:not([placeholder]), textarea[placeholder=""]');
	await editBox.fill(`edited ${Date.now()}`);
	await save.click();

	await expect(page.getByText('Message Updated', { exact: true })).toBeVisible({ timeout: 30_000 });
	// the edited marker + the history toggle appear once a prior version is stored (the label is
	// "Edited" or "Edited by <name>" depending on whether the editor id resolves client-side)
	await expect(page.getByText(/^edited\b/i).first()).toBeVisible({ timeout: 30_000 });
	const viewChanges = page.getByRole('button', { name: /view changes/i });
	await expect(viewChanges).toBeVisible({ timeout: 30_000 });
	await viewChanges.click();
	await expect(page.getByRole('button', { name: /hide changes/i })).toBeVisible({
		timeout: 30_000
	});
});

test('deleting a posted message removes it after the confirm', async ({ page, baseURL }) => {
	const token = await authenticate(page, baseURL);
	const customer = await createCustomer(page, token);
	const ticket = await createTicket(page, token, customer.id);

	await page.goto(`/dashboard/tickets/${ticket.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	const doomed = `delete target ${Date.now()}`;
	await page.getByPlaceholder(/write a reply/i).fill(doomed);
	await page.getByRole('button', { name: /send reply/i }).click();
	await expect(page.getByText(doomed)).toBeVisible({ timeout: 30_000 });

	// the delete uses a native confirm(); accept it before the click resolves
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Delete Message' }).click();

	await expect(page.getByText('Message Deleted', { exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(doomed)).toHaveCount(0, { timeout: 30_000 });
});

test('locking then unlocking a thread from the actions bar', async ({ page, baseURL }) => {
	const token = await authenticate(page, baseURL);
	const customer = await createCustomer(page, token);
	const ticket = await createTicket(page, token, customer.id);

	await page.goto(`/dashboard/tickets/${ticket.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByRole('heading', { name: new RegExp(ticket.title, 'i') })).toBeVisible();

	// lock the thread; the toast fires and the control flips to Unlock (exact names: "Unlock Thread"
	// otherwise substring-matches "Lock Thread")
	await page.getByRole('button', { name: 'Lock Thread', exact: true }).click();
	await expect(page.getByText('Thread Locked', { exact: true })).toBeVisible({ timeout: 30_000 });
	const unlock = page.getByRole('button', { name: 'Unlock Thread', exact: true });
	await expect(unlock).toBeVisible({ timeout: 30_000 });

	// unlock it again
	await unlock.click();
	await expect(page.getByText('Thread Unlocked', { exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('button', { name: 'Lock Thread', exact: true })).toBeVisible({
		timeout: 30_000
	});
});

test('the tickets list shows the empty state and clears filters', async ({
	page,
	baseURL,
	isMobile
}) => {
	// the tabs + filter row interactions are verified on desktop
	test.skip(isMobile, 'the ticket list tabs are verified on desktop');
	await authenticate(page, baseURL);
	await page.goto('/dashboard/tickets', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// switching off the default view makes the filter bar dirty and reveals the Clear control
	await page.getByRole('tab', { name: 'Assigned to Me' }).click();
	const clear = page.getByRole('button', { name: /^clear$/i });
	await expect(clear).toBeVisible({ timeout: 30_000 });

	// a no-match search drives the TicketList empty state
	await page.getByPlaceholder(/search tickets/i).fill(`no-such-ticket-${Date.now()}`);
	await expect(page.getByText(/no tickets found/i)).toBeVisible({ timeout: 30_000 });

	// Clear resets the search + view back to the default
	await clear.click();
	await expect(page.getByPlaceholder(/search tickets/i)).toHaveValue('');
});
