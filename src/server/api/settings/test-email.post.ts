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
		const chain: string[] = [];
		const seen = new Set<unknown>();
		let cur: any = error;
		while (cur && !seen.has(cur) && chain.length < 4) {
			seen.add(cur);
			if (typeof cur === 'string') chain.push(cur);
			else if (cur.message) chain.push(String(cur.message));
			cur = cur?.cause;
		}
		const message = chain.join(' <- ') || String(error);

		console.error('[test-email] send failed', { hostname: transport.hostname, chain });
		const isConnectFailure = /failed to (open|connect)|timed out/i.test(message);
		const hint =
			isConnectFailure && transport.hostname.includes('cloudflare')
				? ' - the worker could not open a socket to smtp.mx.cloudflare.net:465. If Email Sending is already enabled and the DNS records are verified, this is a worker-to-relay connectivity problem rather than a credential or onboarding issue.'
				: '';
		throw createError({
			statusCode: 422,
			message: `Test email failed: ${message}${hint}`,
			data: { success: false }
		});
	}

	return { success: true };
});
