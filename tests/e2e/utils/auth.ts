import type { APIRequestContext, Page } from '@playwright/test';

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

// drive the /login page in a real browser
export async function loginUi(page: Page, creds: Creds = TEST_ADMIN): Promise<void> {
	await page.goto('/login');
	await page
		.getByLabel(/username|email/i)
		.first()
		.fill(creds.username);
	await page
		.getByLabel(/password/i)
		.first()
		.fill(creds.password);
	await page
		.getByRole('button', { name: /log ?in|sign ?in/i })
		.first()
		.click();
}
