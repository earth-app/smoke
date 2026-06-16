import z from 'zod';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	await ensureLoggedIn(event);

	const { id } = await getValidatedRouterParams(
		event,
		z.object({ id: schemas.labelIdParam }).parse
	);
	const label = await getLabelById(id);

	if (!label) {
		throw createError({
			statusCode: 404,
			message: 'Label not found',
			data: { param: id, success: false }
		});
	}

	return label;
});
