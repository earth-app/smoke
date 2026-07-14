import { expect, test } from './fixtures';
import { loginUi, loginViaApi, TEST_ADMIN } from './utils/auth';
import { waitForHydration } from './utils/hydration';

// authenticated projects surface: the list + the SettingsProjects manager form, and a project
// detail page driving <ProjectAddTicket> (create-into). logs in through the ui so currentUser
// hydrates (the manage controls are permission-gated), then grabs an api token to seed a project.

async function authenticate(page: import('@playwright/test').Page): Promise<string> {
	await loginUi(page, TEST_ADMIN);
	await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
	return await loginViaApi(page.request, TEST_ADMIN);
}

async function createProject(page: import('@playwright/test').Page, token: string) {
	const name = `Seeded Project ${Date.now()}`;
	const res = await page.request.post('/api/projects', {
		headers: { Authorization: `Bearer ${token}` },
		data: { name, color: '#3b82f6', description: 'seeded for the projects e2e spec' }
	});
	expect(res.ok(), `project create failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	return (await res.json()) as { id: number; name: string };
}

test.beforeEach(({ browserName }) => {
	test.skip(
		browserName === 'webkit',
		'authenticated dashboard rendering is flaky on local webkit; covered on desktop + mobile-pixel'
	);
});

test('the projects page renders the heading and the manager form', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/projects', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);
	await expect(page).toHaveURL(/\/dashboard\/projects/);
	await expect(page.getByRole('heading', { name: /^projects$/i })).toBeVisible();
	// the SettingsProjects manager (admin has ManageSettings) renders the add form
	await expect(page.getByRole('heading', { name: 'Manage Projects', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: /add project/i })).toBeVisible();
});

test('creating a project through the manager form adds it to the grid', async ({ page }) => {
	await authenticate(page);
	await page.goto('/dashboard/projects', { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	const name = `Form Project ${Date.now()}`;
	await page.getByPlaceholder('Onboarding, Billing, Mobile App...').fill(name);
	await page.getByRole('button', { name: /add project/i }).click();

	await expect(page.getByText('Project Created', { exact: true })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
});

test('the project detail page adds a new ticket into the project', async ({ page }) => {
	const token = await authenticate(page);
	const project = await createProject(page, token);

	await page.goto(`/dashboard/projects/${project.id}`, { waitUntil: 'domcontentloaded' });
	await waitForHydration(page);

	// the project header + the ProjectAddTicket controls render
	await expect(page.getByRole('heading', { name: new RegExp(project.name, 'i') })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByRole('button', { name: 'New Ticket' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add Existing' })).toBeVisible();

	// create-into: open the New Ticket modal and submit
	await page.getByRole('button', { name: 'New Ticket' }).click();
	await expect(page.getByRole('heading', { name: 'New Ticket', exact: true })).toBeVisible();
	await page.getByPlaceholder('Short summary').fill(`Project Ticket ${Date.now()}`);
	await page.getByPlaceholder('Describe the issue').fill('opened into the project by the e2e spec');
	await page.getByRole('button', { name: 'Add to Project' }).click();

	await expect(page.getByText('Ticket Created', { exact: true })).toBeVisible({ timeout: 30_000 });
});
