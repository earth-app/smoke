import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// authenticated labels surface: the LabelManager form (which renders the top-level <ColorPicker>),
// inline color editing, and delete. logs in through the ui so currentUser hydrates (the manage
// controls are permission-gated), then grabs an api token to reset the label set before driving ui.

async function authenticate(page: import('@playwright/test').Page): Promise<string> {
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
	return await loginViaApi(page.request, TEST_ADMIN);
}

// wipe every label so the created row's Edit/Delete controls are unambiguous. loops until the
// list is empty so leftovers from prior specs/runs can't leave a stray row (or a strict-mode match)
async function clearLabels(page: import('@playwright/test').Page, token: string) {
	for (let pass = 0; pass < 10; pass++) {
		const res = await page.request.get('/api/labels', {
			headers: { Authorization: `Bearer ${token}` }
		});
		expect(res.ok(), `label list failed: ${res.status()}`).toBeTruthy();
		const labels = (await res.json()) as { id: number }[];
		if (!labels.length) return;
		for (const label of labels) {
			await page.request.delete(`/api/labels/${label.id}`, {
				headers: { Authorization: `Bearer ${token}` }
			});
		}
	}
}

// seed exactly one label over the api so the single row's Edit/Delete controls are unambiguous
async function seedLabel(page: import('@playwright/test').Page, token: string, name: string) {
	const res = await page.request.post('/api/labels', {
		headers: { Authorization: `Bearer ${token}` },
		data: { name, color: '#3b82f6' }
	});
	expect(res.ok(), `label seed failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	return (await res.json()) as { id: number; name: string };
}

test.beforeEach(({ browserName }) => {
	test.skip(
		browserName === 'webkit',
		'authenticated dashboard rendering is flaky on local webkit; covered on desktop + mobile-pixel'
	);
});

test('the labels page renders the manager form with the color picker', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/labels', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/labels/);
	await expect(page.getByRole('heading', { name: /^labels$/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /add label/i })).toBeVisible();
	// the ColorPicker palette + hex input render inside the create form
	await expect(page.getByPlaceholder('#3B82F6')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Primary' })).toBeVisible();
});

test('create with the color picker, edit the color inline, then delete', async ({ page }) => {
	const token = await authenticate(page);
	await clearLabels(page, token);

	await page.goto('/dashboard/labels', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	const createForm = page
		.locator('form')
		.filter({ has: page.getByRole('button', { name: 'Add Label' }) });

	const name = `Label ${Date.now()}`;
	await createForm.getByPlaceholder('Bug, Billing, Urgent...').fill(name);

	// drive the ColorPicker: pick a palette swatch (its title is the accessible name), then a hex
	await createForm.getByRole('button', { name: 'Primary' }).click();
	await expect(createForm.getByText('Primary', { exact: true })).toBeVisible();
	await createForm.getByPlaceholder('#3B82F6').fill('#22c55e');

	await page.getByRole('button', { name: 'Add Label' }).click();
	await expect(page.getByText('Label Created', { exact: true })).toBeVisible({ timeout: 30_000 });
	// the badge for the new label shows up (only label in the list after the reset)
	await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });

	// edit the color inline: the row swaps to an editor with its own ColorPicker (the second hex
	// input on the page; the create form is the first). change the hex and save
	await page.getByRole('button', { name: 'Edit Label' }).click();
	const editHex = page.getByPlaceholder('#3B82F6').nth(1);
	await expect(editHex).toBeVisible();
	await editHex.fill('#eab308');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Label Updated', { exact: true })).toBeVisible({ timeout: 30_000 });

	// delete: the manager confirms via a native dialog, then removes the row
	page.on('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: 'Delete Label' }).click();
	await expect(page.getByText('Label Deleted', { exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText('No labels yet.')).toBeVisible({ timeout: 30_000 });
});

test('the add-label button is disabled until a name is entered', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/labels', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	const createForm = page
		.locator('form')
		.filter({ has: page.getByRole('button', { name: 'Add Label' }) });
	const add = createForm.getByRole('button', { name: 'Add Label' });
	// draftName starts empty, so the :disabled bind holds; typing a name enables it
	await expect(add).toBeDisabled();
	await createForm.getByPlaceholder('Bug, Billing, Urgent...').fill(`Label ${Date.now()}`);
	await expect(add).toBeEnabled();
});

test('cancelling an inline edit restores the read-only row', async ({ page }) => {
	const token = await authenticate(page);
	await clearLabels(page, token);
	const label = await seedLabel(page, token, `Cancel ${Date.now()}`);

	await page.goto('/dashboard/labels', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByText(label.name).first()).toBeVisible({ timeout: 30_000 });

	// the editor swaps in a Save/Cancel pair; Cancel resets editingId and restores the badge row
	await page.getByRole('button', { name: 'Edit Label' }).click();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Edit Label' })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(label.name).first()).toBeVisible();
});

test('dismissing the delete confirmation keeps the label', async ({ page }) => {
	const token = await authenticate(page);
	await clearLabels(page, token);
	const label = await seedLabel(page, token, `Keep ${Date.now()}`);

	await page.goto('/dashboard/labels', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page.getByText(label.name).first()).toBeVisible({ timeout: 30_000 });

	// decline the native confirm; remove() short-circuits before the delete request
	page.on('dialog', (dialog) => dialog.dismiss());
	await page.getByRole('button', { name: 'Delete Label' }).click();

	await expect(page.getByText(label.name).first()).toBeVisible();
	await expect(page.getByText('No labels yet.')).toHaveCount(0);
});
