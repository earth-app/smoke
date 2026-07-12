// emulates nitro's server/utils auto-import for the unit-test harness:
// re-exports every server-util submodule (so specs can import '#server-utils')
// and registers each export on globalThis (so route handlers and the util
// files' bare cross-references resolve outside the nitro runtime)
import * as agentTokens from '~/server/utils/agent-tokens';
import * as ai from '~/server/utils/ai';
import * as audit from '~/server/utils/audit';
import * as auth from '~/server/utils/auth';
import * as cache from '~/server/utils/cache';
import * as cloudflare from '~/server/utils/cloudflare';
import * as customFields from '~/server/utils/custom-fields';
import * as customer from '~/server/utils/customer';
import * as customerAuth from '~/server/utils/customer-auth';
import * as email from '~/server/utils/email';
import * as emailPoll from '~/server/utils/email-poll';
import * as encryption from '~/server/utils/encryption';
import * as faviconProxy from '~/server/utils/favicon-proxy';
import * as flows from '~/server/utils/flows';
import * as label from '~/server/utils/label';
import * as notifications from '~/server/utils/notifications';
import * as publicTicketAuth from '~/server/utils/public-ticket-auth';
import * as request from '~/server/utils/request';
import * as settings from '~/server/utils/settings';
import * as shard from '~/server/utils/shard';
import * as ticket from '~/server/utils/ticket';
import * as turnstile from '~/server/utils/turnstile';
import * as unfurlFetch from '~/server/utils/unfurl-fetch';
import * as user from '~/server/utils/user';
// shared-type enums/consts (Role, Permission, TicketStatus, ...) are also
// auto-imported into server code at runtime, so register them too
import * as ticketTypes from '~/shared/types/ticket';
import * as userTypes from '~/shared/types/user';
// shared utils are auto-imported into server code too (e.g. displayName in status.get)
import * as userDisplay from '~/shared/utils/user-display';

const modules = [
	encryption,
	faviconProxy,
	flows,
	request,
	cache,
	ai,
	audit,
	auth,
	agentTokens,
	user,
	customer,
	customFields,
	ticket,
	customerAuth,
	label,
	email,
	emailPoll,
	settings,
	shard,
	cloudflare,
	notifications,
	publicTicketAuth,
	turnstile,
	unfurlFetch,
	userTypes,
	ticketTypes,
	userDisplay
];
for (const mod of modules) {
	for (const [key, value] of Object.entries(mod)) {
		(globalThis as Record<string, unknown>)[key] = value;
	}
}

export * from '~/server/utils/agent-tokens';
export * from '~/server/utils/ai';
export * from '~/server/utils/audit';
export * from '~/server/utils/auth';
export * from '~/server/utils/cache';
export * from '~/server/utils/cloudflare';
export * from '~/server/utils/custom-fields';
export * from '~/server/utils/customer';
export * from '~/server/utils/customer-auth';
export * from '~/server/utils/email';
export * from '~/server/utils/email-poll';
export * from '~/server/utils/encryption';
export * from '~/server/utils/favicon-proxy';
export * from '~/server/utils/flows';
export * from '~/server/utils/label';
export * from '~/server/utils/notifications';
export * from '~/server/utils/public-ticket-auth';
export * from '~/server/utils/request';
export * from '~/server/utils/settings';
export * from '~/server/utils/shard';
export * from '~/server/utils/ticket';
export * from '~/server/utils/turnstile';
export * from '~/server/utils/unfurl-fetch';
export * from '~/server/utils/user';
export * from '~/shared/utils/user-display';
