import z from 'zod';
import { logIn } from '~/server/utils';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const { usernameOrEmail, password } = await readValidatedBody(
		event,
		z
			.object({
				usernameOrEmail: schemas.username.or(schemas.email).optional(),
				username: schemas.username.or(schemas.email).optional(),
				password: schemas.passwordParam
			})
			.refine((value) => Boolean(value.usernameOrEmail || value.username), {
				message: 'usernameOrEmail is required',
				path: ['usernameOrEmail']
			})
			.transform((value) => ({
				usernameOrEmail: (value.usernameOrEmail || value.username || '').trim(),
				password: value.password
			})).parse
	);

	try {
		const { user, sessionToken } = await logIn(usernameOrEmail, password, event);
		return { user, session_token: sessionToken, success: true, message: 'Logged in successfully' };
	} catch (error) {
		const statusCode =
			typeof error === 'object' && error !== null && 'statusCode' in error
				? Number((error as { statusCode?: number }).statusCode) || 401
				: 401;
		const message =
			typeof error === 'object' && error !== null && 'message' in error
				? String((error as { message?: unknown }).message || '') ||
					'Error logging in. Please check your credentials and try again.'
				: 'Error logging in. Please check your credentials and try again.';

		throw createError({
			statusCode,
			message,
			stack: error instanceof Error ? error.stack : undefined,
			data: { usernameOrEmail }
		});
	}
});
