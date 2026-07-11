import z from 'zod';

const paramsSchema = z.object({ token: z.string().min(8).max(256) });

// public: report an invite's state so the join page can render without consuming a use
export default defineEventHandler(async (event) => {
	const { token } = await getValidatedRouterParams(event, paramsSchema.parse);

	const invite = await getAgentInvite(token);
	const status = inviteStatus(invite);

	return {
		status,
		// only reveal the bound email while the invite is still usable
		email: status === 'valid' ? (invite?.email ?? null) : null,
		expires: invite?.expires ?? null,
		remaining_uses: invite ? Math.max(0, invite.maxUses - invite.uses) : 0
	};
});
