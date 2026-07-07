import z from 'zod';
import { Permission } from '~/shared/types/user';

const TOKEN_KEY = 'smoke:setting:cloudflare_token';

const body = z.object({
	zone_id: z.string().min(1),
	worker_name: z.string().min(1).optional()
});

type Step = { name: string; ok: boolean; detail?: string };

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageSettings)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const env = event.context.cloudflare.env;
	setMockCf(isMockCf(env));

	const input = await readValidatedBody(event, body.parse);
	const workerName = input.worker_name ?? 'smoke';

	const settings = await getCloudflareSettings();
	const sealed = await kv.get<any>(TOKEN_KEY, 'json').catch(() => null);
	const token = sealed ? await openSecret(sealed, env.MASTER_KEY).catch(() => '') : '';
	if (!token || !settings.account_id) {
		throw createError({ statusCode: 400, message: 'Cloudflare account is not linked' });
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
		const support = (await getEmailSettings()).support_email ?? env.SUPPORT_EMAIL;
		if (!support) throw createError({ statusCode: 400, message: 'No support address configured' });
		await addDestinationAddress(token, settings.account_id!, String(support));
		return String(support);
	});

	// persist zone/worker into the cloudflare setting (merge with existing)
	await setJsonSetting('cloudflare', {
		...settings,
		zone_id: input.zone_id,
		worker_name: workerName
	});

	return { steps };
});
