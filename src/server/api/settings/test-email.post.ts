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
		const message = error instanceof Error ? error.message : String(error);
		const isConnectFailure = /failed to (open|connect)|timed out/i.test(message);
		const hint =
			isConnectFailure && transport.hostname.includes('cloudflare')
				? ' - could not reach smtp.mx.cloudflare.net. Finish "Set Up Email Sending" on the Cloudflare tab (verify your domain with the DKIM/SPF records) so Cloudflare accepts the token.'
				: '';
		throw createError({
			statusCode: 422,
			message: `Test email failed: ${message}${hint}`,
			data: { success: false }
		});
	}

	return { success: true };
});
