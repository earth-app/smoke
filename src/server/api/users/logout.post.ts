import { ensureLoggedIn, logOut } from '~/server/utils';

export default defineEventHandler(async (event) => {
	const user = await ensureLoggedIn(event);

	try {
		await logOut(event);
	} catch (error) {
		throw createError({
			statusCode: 500,
			message: 'An error occurred while logging out',
			stack: error instanceof Error ? error.stack : undefined,
			data: { userId: user.id, success: false }
		});
	}

	return {
		success: true,
		message: 'Logged out successfully'
	};
});
