import { Permission } from '~/shared/types/user';

const TOKEN_KEY = 'smoke:setting:cloudflare_token';

// reads back the live default._bimi record + dmarc policy so the ui can show honest BIMI status.
// BIMI displays only when the record is present AND dmarc is enforcing (p=quarantine|reject)
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

	const email = await getEmailSettings();
	const support = email.support_email || env.SUPPORT_EMAIL;
	const domain = support ? (String(support).split('@')[1] ?? '') : '';
	const rawSite =
		(email as any).site_url || env.NUXT_PUBLIC_SITE_URL || (domain ? `https://${domain}` : '');
	const logoUrl = rawSite ? `${String(rawSite).replace(/\/$/, '')}/bimi/logo.svg` : '';

	if (!token || !settings.account_id || !settings.zone_id || !domain) {
		return {
			configured: false,
			needs_link: !token || !settings.account_id,
			needs_zone: !settings.zone_id,
			needs_domain: !domain,
			domain,
			logo_url: logoUrl,
			record: null,
			dmarc: null
		};
	}

	const [record, dmarc] = await Promise.all([
		getBimiRecord(token, settings.zone_id, domain).catch(() => null),
		getDmarcStatus(token, settings.zone_id, domain).catch(() => null)
	]);

	const vmcUrl = parseBimiRecord(record).vmc;

	return {
		configured: Boolean(record) && Boolean(dmarc?.enforced),
		needs_link: false,
		needs_zone: false,
		needs_domain: false,
		needs_dmarc: !dmarc?.enforced,
		// most inboxes (gmail) need a vmc to actually render the logo
		has_vmc: Boolean(vmcUrl),
		vmc_url: vmcUrl,
		domain,
		logo_url: logoUrl,
		record,
		dmarc
	};
});
