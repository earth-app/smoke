// emulates nitro's server/utils auto-import for the unit-test harness:
// re-exports every server-util submodule (so specs can import '#server-utils')
// and registers each export on globalThis (so route handlers and the util
// files' bare cross-references resolve outside the nitro runtime)
import * as auth from '~/server/utils/auth';
import * as customer from '~/server/utils/customer';
import * as email from '~/server/utils/email';
import * as encryption from '~/server/utils/encryption';
import * as label from '~/server/utils/label';
import * as request from '~/server/utils/request';
import * as ticket from '~/server/utils/ticket';
import * as user from '~/server/utils/user';
// shared-type enums/consts (Role, Permission, TicketStatus, ...) are also
// auto-imported into server code at runtime, so register them too
import * as ticketTypes from '~/shared/types/ticket';
import * as userTypes from '~/shared/types/user';

const modules = [
	encryption,
	request,
	auth,
	user,
	customer,
	ticket,
	label,
	email,
	userTypes,
	ticketTypes
];
for (const mod of modules) {
	for (const [key, value] of Object.entries(mod)) {
		(globalThis as Record<string, unknown>)[key] = value;
	}
}

export * from '~/server/utils/auth';
export * from '~/server/utils/customer';
export * from '~/server/utils/email';
export * from '~/server/utils/encryption';
export * from '~/server/utils/label';
export * from '~/server/utils/request';
export * from '~/server/utils/ticket';
export * from '~/server/utils/user';
