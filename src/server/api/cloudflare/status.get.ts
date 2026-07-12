import { Permission } from '~/shared/types/user';

const TOKEN_KEY = 'smoke:setting:cloudflare_token';

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

	const settings = await getCloudflareSettings();
	const sealed = await kv.get<any>(TOKEN_KEY, 'json').catch(() => null);
	const token = sealed ? await openSecret(sealed, env.MASTER_KEY).catch(() => '') : '';

	if (!token || !settings.account_id) {
		return { linked: false };
	}

	const checklist = {
		routing_enabled: false,
		dkim_records: false,
		worker_wired: Boolean(settings.worker_name),
		destination_registered: false
	};

	let zones: { id: string; name: string }[] = [];
	try {
		zones = await listZones(token, settings.account_id);
	} catch {
		zones = [];
	}

	if (settings.zone_id) {
		try {
			const dns = await getEmailRoutingDns(token, settings.zone_id);
			checklist.routing_enabled = dns.length > 0;
			checklist.dkim_records = dns.some((r) => r.type === 'TXT' && /_domainkey/i.test(r.name));
		} catch {
			checklist.routing_enabled = false;
			checklist.dkim_records = false;
		}

		// honest worker wiring: read the catch-all rule (a worker action = wired). no readable
		// rule (or the offline mock) falls back to the persisted worker marker
		try {
			const rule = await getCatchAllRule(token, settings.zone_id);
			checklist.worker_wired = rule
				? rule.enabled && rule.actions.some((a) => a.type === 'worker')
				: Boolean(settings.worker_name);
		} catch {
			checklist.worker_wired = Boolean(settings.worker_name);
		}
	}

	try {
		const support = (await getEmailSettings()).support_email ?? env.SUPPORT_EMAIL;
		if (support) {
			const addresses = await listDestinationAddresses(token, settings.account_id);
			checklist.destination_registered = addresses.some(
				(a) => a.email?.toLowerCase() === String(support).toLowerCase()
			);
		}
	} catch {
		checklist.destination_registered = false;
	}

	return { linked: true, ...settings, zones, checklist };
});
