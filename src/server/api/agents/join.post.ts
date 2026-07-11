import { ensureCollegeDB } from 'hub:db:schema';
import z from 'zod';
import { Role } from '~/shared/types/user';
import * as schemas from '~/shared/utils/schemas';

const bodySchema = z.object({
	token: z.string().min(8).max(256),
	username: schemas.username,
	password: schemas.passwordParam,
	// used only for an open invite (no bound email); a bound invite's email always wins
	email: schemas.email.optional(),
	firstName: schemas.firstName.optional(),
	lastName: schemas.lastName.optional()
});

// public: redeem an invite to create the agent account and auto-log-in
export default defineEventHandler(async (event) => {
	const env = event.context.cloudflare.env;
	ensureCollegeDB(env);

	const body = await readValidatedBody(event, bodySchema.parse);

	const invite = await getAgentInvite(body.token);
	if (inviteStatus(invite) !== 'valid') {
		throw createError({ statusCode: 400, message: 'This invite link is no longer valid' });
	}

	// bound email locks the address; an open invite collects it at join time
	const email = (invite!.email || body.email || '').trim().toLowerCase();
	if (!email) {
		throw createError({ statusCode: 400, message: 'An email is required to join' });
	}

	// uniqueness guards; read shards directly (not the cached getUserBy*) so a null miss
	// never poisons the 4h user cache for a name we're about to create
	const byUsername = await firstRowByLookup<{ id: string }>(
		`username:${body.username}`,
		`SELECT id FROM users WHERE username = ?`,
		[body.username]
	).catch(() => null);
	if (byUsername) {
		throw createError({ statusCode: 409, message: 'That username is already taken' });
	}
	const emailLookupHash = await hmacSha256(env.HMAC_SECRET, email);
	const byEmail = await firstRowByLookup<{ id: string }>(
		`email_lookup:${emailLookupHash}`,
		`SELECT id FROM users WHERE email_lookup = ?`,
		[emailLookupHash]
	).catch(() => null);
	if (byEmail) {
		throw createError({ statusCode: 409, message: 'An account with that email already exists' });
	}

	const { id, sessionToken } = await createUser(body.username, email, Role.Agent, env);

	// setting the password is the one non-recoverable step; roll the account back on failure
	try {
		await setInitialPassword(id, body.password);
	} catch (error) {
		await deleteUser(id).catch(() => {});
		throw error;
	}

	// optional real name (first name required when a last name is given)
	if (body.firstName && body.firstName.trim()) {
		try {
			const created = await getUserById(id, env);
			if (created) {
				await patchUser(
					created,
					{
						first_name: body.firstName.trim(),
						last_name: body.lastName?.trim() || undefined
					},
					env
				);
			}
		} catch (error) {
			console.warn('join: failed to set agent name', error);
		}
	}

	// consume only after the account is real so a failed create doesn't burn a use
	await consumeAgentInvite(body.token, env).catch(() => {});

	// parity with the admin-create route: fire the agent.created flow trigger
	try {
		const agent = await getUserById(id, env).catch(() => null);
		await runTicketFlows(
			{
				trigger: 'agent.created',
				agent: agent
					? { id: agent.id, username: agent.username, name: agent.name, role: agent.role }
					: { id, username: body.username }
			},
			env
		).catch(() => {});
	} catch {
		// flow failures never block onboarding
	}

	return { success: true, user_id: id, session_token: sessionToken };
});
