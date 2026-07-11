import z from 'zod';
import { Permission } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({
	email: schemas.email.optional(),
	ttlMinutes: z.coerce.number().int().min(1).max(1440).optional(),
	maxUses: z.coerce.number().int().min(1).max(100).optional()
});

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageUsers)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const env = event.context.cloudflare.env;
	const body = await readValidatedBody(event, bodySchema.parse);

	const { token, invite } = await createAgentInvite(
		{
			email: body.email,
			createdBy: current.id,
			ttlMinutes: body.ttlMinutes,
			maxUses: body.maxUses
		},
		env
	);

	const url = await inviteUrl(token, env);

	// email the link when a target address is given; best-effort so a transport hiccup
	// never fails the invite itself (the manager can always copy the returned url)
	let emailed = false;
	if (invite.email) {
		const subject = 'You Have Been Invited to Join the Support Team';
		const site = url.replace(/\/join\/.*$/, '');
		const text =
			`You have been invited to join the support team.\n\n` +
			`Set up your account here: ${url}\n\n` +
			`This link expires soon and can only be used a limited number of times.` +
			(site ? `\n\n${site}` : '');
		emailed = await sendCustomerEmail(invite.email, subject, text, env).catch(() => false);
	}

	return {
		success: true,
		token,
		url,
		email: invite.email ?? null,
		expires: invite.expires,
		max_uses: invite.maxUses,
		emailed
	};
});
