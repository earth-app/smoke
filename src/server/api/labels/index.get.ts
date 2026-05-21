import { ensureLoggedIn, listLabels } from '~/server/utils';

export default defineEventHandler(async (event) => {
	await ensureLoggedIn(event);

	try {
		return await listLabels();
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to list labels',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
