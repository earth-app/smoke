import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { waitForHydration } from './hydration';

export const TEST_ADMIN = {
	username: 'admin',
	email: 'admin@smoke.test',
	password: 'Password123!'
};

type Creds = { username: string; email?: string; password: string };

// log in over the api; returns the session token. checks an existing session first
// so repeated logins don't trip the auth rate limiter
export async function loginViaApi(
	request: APIRequestContext,
	creds: Creds = TEST_ADMIN
): Promise<string> {
	try {
		const s = await request.get('/api/users/session');
		if (s.ok()) {
			const body = await s.json();
			if (body?.session_token) return body.session_token;
		}
	} catch {
		// fall through to a fresh login
	}
	const res = await request.post('/api/users/login', {
		data: { usernameOrEmail: creds.username, password: creds.password }
	});
	if (!res.ok()) throw new Error(`login failed: ${res.status()} ${await res.text()}`);
	const body = await res.json();
	return body.session_token;
}

// drive the /login page in a real browser; keeps an existing /login?redirect= url.
// robust against the hydration/fill race: waits for hydration so the UInput v-model is
// wired, asserts each input actually holds its value before submit, and re-fills+re-submits
// (bounded) if a lost fill left validate() rejecting an empty state and kept us on /login
export async function loginUi(page: Page, creds: Creds = TEST_ADMIN): Promise<void> {
	if (!page.url().includes('/login')) await page.goto('/login');
	await waitForHydration(page);

	const username = page.getByLabel(/username|email/i).first();
	const password = page.getByLabel(/password/i).first();
	const submit = page.getByRole('button', { name: /log ?in|sign ?in/i }).first();

	for (let attempt = 1; attempt <= 3; attempt++) {
		if (attempt > 1) {
			// a prior empty submit leaves the form in an error state where re-fill sticks empty;
			// reload for a fresh form (keeps the ?redirect= on the url) before trying again
			await page.reload({ waitUntil: 'domcontentloaded' });
			await waitForHydration(page);
		}
		try {
			await username.fill(creds.username);
			await password.fill(creds.password);
			// settle-gate: the inputs must hold their values before submit (never fire on empty)
			await expect(username).toHaveValue(creds.username);
			await expect(password).toHaveValue(creds.password);
			await submit.click();
			// a lost fill submits empty, validate() rejects, and we stay on /login -> reload + retry
			await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
			return;
		} catch (error) {
			if (attempt === 3) throw error;
		}
	}
}
