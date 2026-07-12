import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageCustomers)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const env = event.context.cloudflare.env;
	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.customerIdParam }).parse
	);

	const customer = await getCustomerById(id, env);
	if (!customer) {
		throw createError({
			statusCode: 404,
			message: 'Customer not found',
			data: { param: id, success: false }
		});
	}

	const token = await issueCustomerMagicLink(id, env);
	const url = await customerMagicLinkUrl(token, env);

	await recordAudit(env, {
		action: 'customer.magic_link_issued',
		actorId: current.id,
		actorName: current.name || current.username,
		targetType: 'customer',
		targetId: id,
		summary: `Portal access link issued for customer ${customer.name || customer.email || `#${id}`}`
	});

	return { url, token };
});
