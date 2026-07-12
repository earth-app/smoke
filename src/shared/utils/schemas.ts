import z from 'zod';
import type { TicketPriority, TicketStatus, TicketVisibility } from '~/shared/types/ticket';
import type { Permission, Role } from '~/shared/types/user';

// enum values are hardcoded (not Object.values(Enum)) because nuxt auto-imports make
// shared/types import this file back, so reading the enum objects at module-eval tdz-crashes.
// the `satisfies` guards below fail typecheck if these drift from the source enums (both ways)
type Exact<A extends string, B extends string> = [A] extends [B]
	? [B] extends [A]
		? true
		: never
	: never;

const ROLE_VALUES = ['agent', 'manager', 'admin'] as const;
true satisfies Exact<`${Role}`, (typeof ROLE_VALUES)[number]>;

const PERMISSION_VALUES = [
	'reply_ticket',
	'create_ticket',
	'manage_ticket',
	'open_ticket',
	'close_ticket',
	'change_labels',
	'manage_labels',
	'create_ticket_messages',
	'manage_ticket_messages',
	'link_issue',
	'add_email',
	'remove_email',
	'view_private_tickets',
	'toggle_private',
	'lock_thread',
	'chat_in_locked',
	'change_customer_name',
	'change_customer_tags',
	'manage_customers',
	'manage_self',
	'manage_users',
	'change_user_labels',
	'change_avatar',
	'manage_settings',
	'manage_maintenance',
	'view_audit_log'
] as const;
true satisfies Exact<`${Permission}`, (typeof PERMISSION_VALUES)[number]>;

const TICKET_STATUS_VALUES = [
	'submitted',
	'open',
	'pending',
	'work_in_progress',
	'closed',
	'wont_fix'
] as const;
true satisfies Exact<`${TicketStatus}`, (typeof TICKET_STATUS_VALUES)[number]>;

const TICKET_PRIORITY_VALUES = ['none', 'low', 'medium', 'high', 'critical'] as const;
true satisfies Exact<`${TicketPriority}`, (typeof TICKET_PRIORITY_VALUES)[number]>;

const TICKET_VISIBILITY_VALUES = ['public', 'internal', 'private'] as const;
true satisfies Exact<`${TicketVisibility}`, (typeof TICKET_VISIBILITY_VALUES)[number]>;

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

// an iconify icon name (e.g. mdi:robot) used as an avatar via the `icon:` sentinel
export const avatar_icon = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9]+[a-z0-9:_-]*$/i, 'Icon must be an iconify name like mdi:robot')
	.describe('An iconify icon name used as an avatar');

// a color for a label/entity: a css hex (#rgb or #rrggbb) OR a nuxt ui theme token.
// nuxt tokens kept in sync with shared/utils/colors NUXT_COLORS (hardcoded to avoid the auto-import cycle)
export const colorValue = z
	.string()
	.refine(
		(v) =>
			/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ||
			['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'].includes(v),
		'Color must be a hex value (#rgb or #rrggbb) or a theme color'
	)
	.describe('A hex color or a nuxt ui theme color token');

// #endregion

// #region enums

export const role = z
	.enum(ROLE_VALUES)
	.describe('The role of a user, which determines their permissions');
export const permissions = z
	.array(z.enum(PERMISSION_VALUES))
	.describe('A list of permissions assigned to a user');

// #endregion

// #region objects

export const label = z
	.object({
		id: numId,
		name: z.string().max(48, 'Label name cannot be longer than 48 characters'),
		color: colorValue.optional()
	})
	.describe('A label that can be applied to users or customers for organizational purposes');

// coerce: router params arrive as strings (matches ticketIdParam)
export const labelIdParam = z.coerce.number().int().positive().describe('A numerical label ID');

export const labelCreateBody = z
	.object({
		name: z.string().min(1).max(48),
		color: colorValue.optional()
	})
	.describe('The body of a POST request to create a label');

export const labelPatchBody = z
	.object({
		name: z.string().min(1).max(48).optional(),
		color: colorValue.optional()
	})
	.describe('The body of a PATCH request to update a label');

// coerce: router params arrive as strings (matches ticketIdParam)
export const customerIdParam = z.coerce
	.number()
	.int()
	.positive()
	.describe('A numerical customer ID');

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
		email: email.optional(),
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

export const firstName = z.string().min(1).max(64).describe('The optional first (given) name');
export const lastName = z.string().min(1).max(64).describe('The optional last (family) name');

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
		first_name: firstName.optional(),
		last_name: lastName.optional(),
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

// any ascii symbol/punctuation counts as a special character (covers ^ ~ ` + = / \ ; : < > ? ()[]{} etc.)
export const PASSWORD_SPECIAL = /[!-/:-@[-`{-~]/;

export const passwordParam = z
	.string()
	.min(12, 'Password must be at least 12 characters long')
	.max(128, 'Password cannot be longer than 128 characters')
	.regex(/(?=.*[a-z])/, 'Password must contain at least one lowercase letter')
	.regex(/(?=.*[A-Z])/, 'Password must contain at least one uppercase letter')
	.regex(/(?=.*\d)/, 'Password must contain at least one number')
	.regex(
		/(?=.*[!-/:-@[-`{-~])/,
		'Password must contain at least one special character (e.g. ! ? @ # ^ ~ / = + ; :)'
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
		first_name: firstName.optional(),
		last_name: lastName.optional(),
		avatar_url: avatar_url,
		role: role.optional(),
		permissions: permissions.optional(),
		labels: z.array(label).optional()
	})
	// a last name requires a first name; a first name alone is fine
	.refine((d) => !d.last_name || !!d.first_name, {
		message: 'A first name is required when a last name is set',
		path: ['first_name']
	})
	.describe('The body of a PATCH request to update a user');

export const ticketIdParam = z.coerce.number().int().positive().describe('A numerical ticket ID');

export const ticketMessageIdParam = z.coerce
	.number()
	.int()
	.nonnegative()
	.describe('A numerical ticket message ID');

export const ticketStatus = z.enum(TICKET_STATUS_VALUES);

export const ticketPriority = z.enum(TICKET_PRIORITY_VALUES);

export const ticketVisibility = z.enum(TICKET_VISIBILITY_VALUES);

// shared optional metadata accepted on ticket create + patch
const ticketMetaShape = {
	visibility: ticketVisibility.optional(),
	source: z.enum(['guest', 'emailed', 'team']).optional(),
	color: z
		.string()
		.regex(/^#([0-9a-fA-F]{3}){1,2}$/, 'Color must be a hex value')
		.nullable()
		.optional(),
	// iconify icon name for the ticket's visual identity (paired with color)
	icon: z
		.string()
		.max(64)
		.regex(/^[a-z0-9]+[a-z0-9:_-]*$/i)
		.nullable()
		.optional(),
	deadline: z.union([z.string(), z.date()]).nullable().optional(),
	// legacy single project kept for back-compat; project_ids is the source of truth
	project_id: z.coerce.number().int().positive().nullable().optional(),
	project_ids: z.array(z.coerce.number().int().positive()).max(50).optional(),
	custom_fields: z.record(z.string(), z.string()).optional()
};

export const ticketActor = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('user'),
		id: id,
		username,
		email: email.optional(),
		name: user.shape.name.optional(),
		avatar_url,
		role: role.optional(),
		ai: z.boolean().optional()
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
		// optional: 0 or omitted opens a customer-less internal ticket
		customer_id: z.coerce.number().int().nonnegative().optional(),
		status: ticketStatus.optional(),
		priority: ticketPriority.optional(),
		labels: z.array(z.coerce.number().int().nonnegative()).optional(),
		assignee_ids: z.array(id).optional(),
		private: z.boolean().optional(),
		...ticketMetaShape
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
		private: z.boolean().optional(),
		// archived read-only gate: an archived ticket only accepts a body that sets archived: false
		archived: z.boolean().optional(),
		...ticketMetaShape
	})
	.describe('The body of a PATCH request to update a ticket');

export const ticketMessageCreateBody = z
	.object({
		message: z.string().min(1).max(10_000),
		reply_to: z.coerce.number().int().nonnegative().optional(),
		sender: ticketActor.optional(),
		attachments: z.array(ticketAttachment).optional(),
		identity: z.enum(['self', 'team']).optional(),
		// composer-added cc emails; each becomes a ticket participant + is copied on the mirror
		cc: z.array(email).max(20).optional()
	})
	.describe('The body of a POST request to append a ticket message');

// #endregion
