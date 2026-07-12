import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({ to: schemas.email });

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageSettings)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const env = event.context.cloudflare.env;
	const body = await readValidatedBody(event, bodySchema.parse);

	const transport = await getEmailConfig(env);
	if (!transport) {
		throw createError({ statusCode: 400, message: 'Email Is Not Configured' });
	}

	const { send } = await import('edgeport/smtp');
	try {
		await send({
			hostname: transport.hostname,
			port: transport.port,
			tls: transport.tls,
			auth: transport.auth,
			from: transport.from,
			to: body.to,
			subject: 'Smoke Test Email',
			text: 'This is a test email from your Smoke support desk.'
		});
	} catch (error) {
		// a bad/placeholder transport (e.g. an invalid Cloudflare token) must surface as a clean
		// 422, not an unhandled 500 - the message helps the owner fix their credentials
		const message = error instanceof Error ? error.message : String(error);
		throw createError({
			statusCode: 422,
			message: `Test email failed: ${message}`,
			data: { success: false }
		});
	}

	return { success: true };
});
