import { createUser, ensureLoggedIn } from '~/server/utils';
import { Permission, Role } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageUsers)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const { username, email } = await readValidatedBody(event, schemas.userCreateBody.parse);

	try {
		await createUser(username, email, Role.Agent, event.context.cloudflare.env);
	} catch (error) {
		throw createError({
			statusCode: 500,
			message: 'Failed to create user',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}

	return {
		success: true,
		message: `User ${username} created successfully`
	};
});
