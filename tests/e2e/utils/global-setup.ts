import { chromium, type FullConfig } from '@playwright/test';
import { TEST_ADMIN } from './auth';

const BASE_URL = 'http://127.0.0.1:4000';

async function ping(url: string): Promise<boolean> {
	try {
		const res = await fetch(url, { method: 'GET' });
		return res.ok;
	} catch {
		return false;
	}
}

// warm every route in a real browser so vite compiles each client bundle once, up front.
// fetch()-warming only compiles the server render; the first browser visit still pays the
// client-bundle compile which, on a loaded ci runner, can blow past a test's timeout
export default async function globalSetup(_config: FullConfig) {
	// wait until the server is up
	const deadline = Date.now() + 240_000;
	while (Date.now() < deadline) {
		if (await ping(`${BASE_URL}/api/setup/status`)) break;
		await new Promise((r) => setTimeout(r, 1000));
	}

	// ensure an admin exists; 409 means setup already ran, which is fine
	try {
		await fetch(`${BASE_URL}/api/setup/init`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				username: TEST_ADMIN.username,
				email: TEST_ADMIN.email,
				password: TEST_ADMIN.password
			})
		});
	} catch {
		// ignore; the server may already be seeded
	}

	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({ baseURL: BASE_URL });
		const page = await context.newPage();
		const routes = ['/', '/login', '/submit', '/dashboard', '/dashboard/tickets', '/setup'];
		for (const r of routes) {
			try {
				await page.goto(r, { waitUntil: 'domcontentloaded', timeout: 120_000 });
				await page
					.waitForFunction(() => document.documentElement.dataset.hydrated === 'true', null, {
						timeout: 60_000
					})
					.catch(() => {});
			} catch {
				// ignore warmup failures; the point is to pay the compile cost, not to assert
			}
		}
		await context.close();
	} finally {
		await browser.close();
	}
}
