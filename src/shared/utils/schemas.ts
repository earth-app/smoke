import z from 'zod';
import { TicketPriority, TicketStatus } from '~/shared/types/ticket';
import { Permission, Role } from '~/shared/types/user';

// #region primitives

export const id = z
	.string()
	.length(32, 'ID must be exactly 32 characters long')
	.regex(/^[a-zA-Z0-9]+$/)
	.describe('A unique identifier string, represented as a UUID without dashes');

export const numId = z.number().describe('A numerical ID that increments by 1 for every object');

export const username = z
	.string()
	.min(3, 'Username must be at least 3 characters long')
	.max(64, 'Username cannot be longer than 64 characters')
	.regex(/^[a-zA-Z0-9_$%~.<>]+$/);

export const email = z.email().max(128, 'Emails cannot be longer than 128 characters');

export const avatar_url = z
	.url()
	.refine((url) => new URL(url).protocol === 'https:', 'Avatar URL must be HTTPS')
	.max(256, 'Avatar URL cannot be longer than 256 characters')
	.optional()
	.describe('An optional URL string that points to an avatar image for a user or customer');

// #endregion

// #region enums

export const role = z
	.enum(Object.values(Role))
	.describe('The role of a user, which determines their permissions');
export const permissions = z
	.array(z.enum(Object.values(Permission)))
	.describe('A list of permissions assigned to a user');

// #endregion

// #region objects

export const label = z
	.object({
		id: numId,
		name: z.string().max(48, 'Label name cannot be longer than 48 characters'),
		color: z.hex().optional()
	})
	.describe('A label that can be applied to users or customers for organizational purposes');

export const labelIdParam = numId.int().positive().describe('A numerical label ID');

export const labelCreateBody = z
	.object({
		name: z.string().min(1).max(48),
		color: z.hex().optional()
	})
	.describe('The body of a POST request to create a label');

export const labelPatchBody = z
	.object({
		name: z.string().min(1).max(48).optional(),
		color: z.hex().optional()
	})
	.describe('The body of a PATCH request to update a label');

export const customerIdParam = numId.int().positive().describe('A numerical customer ID');

export const customer = z
	.object({
		id: customerIdParam,
		email,
		name: z.string().min(1).max(128).optional(),
		avatar_url,
		tags: z.array(label),
		created_at: z.date(),
		updated_at: z.date()
	})
	.describe('A customer that can create and receive tickets');

export const customerCreateBody = z
	.object({
		email,
		name: z.string().min(1).max(128).optional(),
		avatar_url,
		tags: z.array(label).optional()
	})
	.describe('The body of a POST request to create a customer');

export const customerPatchBody = z
	.object({
		email: email.optional(),
		name: z.string().min(1).max(128).optional(),
		avatar_url,
		tags: z.array(label).optional()
	})
	.describe('The body of a PATCH request to update a customer');

export const user = z
	.object({
		id,
		username,
		email,
		name: z
			.string()
			.min(3, 'Name must be at least 3 characters')
			.max(128, 'Name can be at most 128 characters')
			.optional()
			.describe('The name of the user'),
		avatar_url,
		role,
		permissions,
		created_at: z.date(),
		updated_at: z.date(),
		labels: z.array(label)
	})
	.describe('A registered user that performs actions for customers');

// #endregion

// #region parameters

export const usernameParam = username.refine(
	(val) =>
		val !== 'current' && val.startsWith('@') && val.slice(1).length > 3 && val.slice(1).length < 64
);

export const passwordParam = z
	.string()
	.min(8, 'Password must be at least 8 characters long')
	.max(128, 'Password cannot be longer than 128 characters')
	.regex(/(?=.*[a-z])/, 'Password must contain at least one lowercase letter')
	.regex(/(?=.*[A-Z])/, 'Password must contain at least one uppercase letter')
	.regex(/(?=.*\d)/, 'Password must contain at least one number')
	.regex(
		/(?=.*[@$!%*?&])/,
		'Password must contain at least one special character (@, $, !, %, *, ?, &)'
	)
	.describe('A password string that meets complexity requirements');

export const userIdParam = id
	.or(usernameParam)
	.or(z.literal('current'))
	.describe(
		'A parameter that can be a user ID, username, or "current" to refer to the logged-in user'
	);

// #endregion

// #region request body

export const userCreateBody = z
	.object({
		username,
		email
	})
	.describe('The body of a POST request to create a new user, completed by an administrator');

export const userPatchBody = z
	.object({
		username: username.optional(),
		email: email.optional(),
		name: user.shape.name.optional(),
		avatar_url: avatar_url,
		role: role.optional(),
		permissions: permissions.optional(),
		labels: z.array(label).optional()
	})
	.describe('The body of a PATCH request to update a user');

export const ticketIdParam = z.coerce.number().int().positive().describe('A numerical ticket ID');

export const ticketMessageIdParam = z.coerce
	.number()
	.int()
	.nonnegative()
	.describe('A numerical ticket message ID');

export const ticketStatus = z.enum(Object.values(TicketStatus));

export const ticketPriority = z.enum(Object.values(TicketPriority));

export const ticketActor = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('user'),
		id: id,
		username,
		email: email.optional(),
		name: user.shape.name.optional(),
		avatar_url
	}),
	z.object({
		kind: z.literal('customer'),
		id: z.coerce.number().int().nonnegative(),
		email: email.optional(),
		name: z.string().min(1).max(128).optional(),
		avatar_url
	})
]);

export const ticketAttachment = z.object({
	file_name: z.string().min(1).max(255),
	mimetype: z.string().min(1).max(255),
	data: z.string().min(1)
});

export const ticketCreateBody = z
	.object({
		title: z.string().min(1).max(200),
		description: z.string().min(1).max(10_000),
		customer_id: z.coerce.number().int().nonnegative(),
		status: ticketStatus.optional(),
		priority: ticketPriority.optional(),
		labels: z.array(z.coerce.number().int().nonnegative()).optional(),
		assignee_ids: z.array(id).optional(),
		private: z.boolean().optional()
	})
	.describe('The body of a POST request to create a new ticket');

export const ticketPatchBody = z
	.object({
		title: z.string().min(1).max(200).optional(),
		description: z.string().min(1).max(10_000).optional(),
		customer_id: z.coerce.number().int().nonnegative().optional(),
		status: ticketStatus.optional(),
		priority: ticketPriority.optional(),
		labels: z.array(z.coerce.number().int().nonnegative()).optional(),
		assignee_ids: z.array(id).optional(),
		private: z.boolean().optional()
	})
	.describe('The body of a PATCH request to update a ticket');

export const ticketMessageCreateBody = z
	.object({
		message: z.string().min(1).max(10_000),
		reply_to: z.coerce.number().int().nonnegative().optional(),
		sender: ticketActor.optional(),
		attachments: z.array(ticketAttachment).optional()
	})
	.describe('The body of a POST request to append a ticket message');

// #endregion
