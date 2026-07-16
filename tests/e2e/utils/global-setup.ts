import { chromium, type FullConfig } from '@playwright/test';
import { TEST_ADMINS } from './auth';

const BASE_URL = 'http://127.0.0.1:4000';

async function ping(url: string): Promise<boolean> {
	try {
		const res = await fetch(url, { method: 'GET' });
		return res.ok;
	} catch {
		return false;
	}
}

// seed the per-worker admins beyond the owner (index 0): invite -> join (sets a password) ->
// promote to admin, as the owner. best-effort + idempotent (409 = already exists). a worker whose
// admin fails to seed just falls back to the owner in auth.ts, so this never blocks the run
async function seedExtraAdmins(): Promise<void> {
	const owner = TEST_ADMINS[0]!;
	let ownerToken: string;
	try {
		const res = await fetch(`${BASE_URL}/api/users/login`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ usernameOrEmail: owner.username, password: owner.password })
		});
		if (!res.ok) return;
		ownerToken = ((await res.json()) as { session_token: string }).session_token;
	} catch {
		return;
	}
	const authHeaders = { 'content-type': 'application/json', Authorization: `Bearer ${ownerToken}` };

	for (const admin of TEST_ADMINS.slice(1)) {
		try {
			const inv = await fetch(`${BASE_URL}/api/agents/invite`, {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({ maxUses: 1, ttlMinutes: 60 })
			});
			if (!inv.ok) continue;
			const { token } = (await inv.json()) as { token: string };

			const join = await fetch(`${BASE_URL}/api/agents/join`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					token,
					username: admin.username,
					password: admin.password,
					email: admin.email
				})
			});
			if (!join.ok) continue; // 409 -> already seeded on a prior run
			const { user_id } = (await join.json()) as { user_id: string };

			await fetch(`${BASE_URL}/api/users/${user_id}`, {
				method: 'PATCH',
				headers: authHeaders,
				body: JSON.stringify({ role: 'admin' })
			});
		} catch {
			// tolerate; the worker falls back to the owner account
		}
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

	// ensure the owner admin exists; 409 means setup already ran, which is fine
	try {
		await fetch(`${BASE_URL}/api/setup/init`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				username: TEST_ADMINS[0]!.username,
				email: TEST_ADMINS[0]!.email,
				password: TEST_ADMINS[0]!.password
			})
		});
	} catch {
		// ignore; the server may already be seeded
	}

	// seed one admin per parallel worker (see auth.ts) so concurrent logins don't evict each other
	await seedExtraAdmins();

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
