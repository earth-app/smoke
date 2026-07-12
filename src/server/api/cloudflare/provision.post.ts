import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { Permission } from '~/shared/types/user';

const TOKEN_KEY = 'smoke:setting:cloudflare_token';

const body = z.object({
	zone_id: z.string().min(1),
	worker_name: z.string().min(1).optional(),
	support_email: z.string().optional(),
	token: z.string().optional(),
	account_id: z.string().optional()
});

type Step = { name: string; ok: boolean; detail?: string };

export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);
	setMockCf(isMockCf(env));

	// gate: a logged-in staffer needs ManageSettings; unauthenticated is allowed ONLY during
	// first-run setup (no admin exists yet) so the wizard can provision before the account is made
	const current = await getOptionalLoggedIn(event);
	if (current) {
		if (!current.permissions.includes(Permission.ManageSettings)) {
			throw createError({
				statusCode: 403,
				message: 'You do not have permission to perform this action'
			});
		}
	} else {
		const users = await listUsers(env, '', 1, 1, 0, 'created_at', 'desc');
		if (users.length > 0) {
			throw createError({ statusCode: 401, message: 'Authentication required' });
		}
	}

	const input = await readValidatedBody(event, body.parse);
	const workerName = input.worker_name ?? 'smoke';
	const inputSupport = input.support_email?.trim();

	const settings = await getCloudflareSettings();

	// resolve creds: an explicit body token/account (setup wizard, before sealing) wins, then the
	// linked/sealed token, then an env token; mirrors cloudflare/provision-email + test
	let resolvedToken = input.token?.trim();
	if (!resolvedToken) {
		const sealed = await kv.get<any>(TOKEN_KEY, 'json').catch(() => null);
		resolvedToken = sealed ? await openSecret(sealed, env.MASTER_KEY).catch(() => '') : '';
	}
	if (!resolvedToken) resolvedToken = cloudflareApiToken(env);
	const resolvedAccountId = input.account_id?.trim() || settings.account_id;
	if (!resolvedToken || !resolvedAccountId) {
		throw createError({ statusCode: 400, message: 'Cloudflare account is not linked' });
	}
	const token = resolvedToken;
	const accountId = resolvedAccountId;

	// persist a wizard-provided support address so the destination step + later status agree on it
	if (inputSupport) {
		const email = await getEmailSettings();
		await setJsonSetting('email', { ...email, support_email: inputSupport });
		await setStringSetting('supportEmail', inputSupport);
	}

	const steps: Step[] = [];
	const run = async (name: string, fn: () => Promise<string | void>) => {
		try {
			const detail = await fn();
			steps.push({ name, ok: true, detail: detail || undefined });
		} catch (error) {
			steps.push({ name, ok: false, detail: explainCfError(error) });
		}
	};

	await run('enable_email_routing', async () => {
		await enableEmailRouting(token, input.zone_id);
	});

	await run('dns_records', async () => {
		const records = await getEmailRoutingDns(token, input.zone_id);
		const result = await ensureEmailDnsRecords(token, input.zone_id, records);
		return `created ${result.created.length}, skipped ${result.skipped.length}`;
	});

	await run('catch_all_worker', async () => {
		await upsertCatchAllToWorker(token, input.zone_id, workerName);
	});

	await run('destination_address', async () => {
		const support = inputSupport || (await getEmailSettings()).support_email || env.SUPPORT_EMAIL;
		if (!support) throw createError({ statusCode: 400, message: 'No support address configured' });
		await addDestinationAddress(token, accountId, String(support));
		return String(support);
	});

	// persist account/zone/worker into the cloudflare setting (merge with existing)
	await setJsonSetting('cloudflare', {
		...settings,
		account_id: accountId,
		zone_id: input.zone_id,
		worker_name: workerName
	});

	return { steps };
});
