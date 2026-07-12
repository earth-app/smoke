import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageLabels)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

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

	const body = await readValidatedBody(event, schemas.labelPatchBody.parse);

	try {
		const updated = await patchLabel(id, body);
		await runTicketFlows(
			{
				trigger: 'label.updated',
				label: { id: updated.id, name: updated.name, color: updated.color }
			},
			event.context.cloudflare.env
		).catch(() => {});
		return updated;
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to update label',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
