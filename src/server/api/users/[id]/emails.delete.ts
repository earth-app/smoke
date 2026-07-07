import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({ email: schemas.email });

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	const { id } = await getValidatedRouterParams(event, z.object({ id: schemas.userIdParam }).parse);

	const target = await getUserBy(id, event);
	if (!target) {
		throw createError({ statusCode: 404, message: 'User not found' });
	}

	const isSelf = current.id === target.id;
	const allowed =
		current.permissions.includes(Permission.ManageUsers) ||
		(isSelf && current.permissions.includes(Permission.ManageSelf));
	if (!allowed) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const env = event.context.cloudflare.env;
	const body = await readValidatedBody(event, bodySchema.parse);
	await unlinkAgentEmail(env, body.email);

	return { success: true };
});
