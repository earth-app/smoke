export type Label = {
	id: number;
	name: string;
	color?: string;
};

export type Customer = {
	id: number;
	email: string;
	name?: string;
	avatar_url?: string;
	tags: Label[];
	created_at: Date;
	updated_at: Date;
};

export type User = {
	id: string;
	username: string;
	email: string;
	name?: string;
	avatar_url?: string;
	role: Role;
	permissions: Permission[];
	created_at: Date;
	updated_at: Date;
	labels: Label[];
};

export enum Permission {
	// ticket permissions
	ReplyTicket = 'reply_ticket',
	CreateTicket = 'create_ticket',
	ManageTicket = 'manage_ticket',
	OpenTicket = 'open_ticket',
	CloseTicket = 'close_ticket',
	ChangeLabels = 'change_labels',
	ManageLabels = 'manage_labels',
	CreateTicketMessages = 'create_ticket_messages',
	ManageTicketMessages = 'manage_ticket_messages',
	LinkIssue = 'link_issue',
	AddEmail = 'add_email',
	RemoveEmail = 'remove_email',
	// customer permissions
	ChangeCustomerName = 'change_customer_name',
	ChangeCustomerTags = 'change_customer_tags',
	// user permissions
	ManageSelf = 'manage_self',
	ManageUsers = 'manage_users',
	ChangeUserLabels = 'change_user_labels',
	// admin permissions
	ManageSettings = 'manage_settings',
	ToggleMaintenance = 'manage_maintenance'
}

export type PermissionData = {
	description: string;
	category: 'tickets' | 'customers' | 'users' | 'admin';
};

export enum Role {
	Agent = 'agent',
	Manager = 'manager',
	Admin = 'admin'
}

export const ALL_PERMISSIONS: Record<Permission, PermissionData> = {
	// tickets
	[Permission.ReplyTicket]: {
		description: 'Allows the user to reply to tickets.',
		category: 'tickets'
	},
	[Permission.CreateTicket]: {
		description: 'Allows the user to create new tickets.',
		category: 'tickets'
	},
	[Permission.ManageTicket]: {
		description: 'Allows the user to update and delete tickets.',
		category: 'tickets'
	},
	[Permission.OpenTicket]: {
		description: 'Allows the user to open closed tickets.',
		category: 'tickets'
	},
	[Permission.CloseTicket]: {
		description: 'Allows the user to close open tickets.',
		category: 'tickets'
	},
	[Permission.CreateTicketMessages]: {
		description: 'Allows the user to create, update, and delete their own messages on tickets.',
		category: 'tickets'
	},
	[Permission.ManageTicketMessages]: {
		description: 'Allows the user to update and delete any message on tickets.',
		category: 'tickets'
	},
	[Permission.ChangeLabels]: {
		description: 'Allows the user to change the labels on tickets.',
		category: 'tickets'
	},
	[Permission.ManageLabels]: {
		description: 'Allows the user to create and delete labels.',
		category: 'tickets'
	},
	[Permission.LinkIssue]: {
		description: 'Allows the user to link issues to tickets.',
		category: 'tickets'
	},
	[Permission.AddEmail]: {
		description: 'Allows the user to add an email to a ticket.',
		category: 'tickets'
	},
	[Permission.RemoveEmail]: {
		description: 'Allows the user to remove an email from a ticket.',
		category: 'tickets'
	},
	// customers
	[Permission.ChangeCustomerName]: {
		description: "Allows the user to change a customer's name.",
		category: 'customers'
	},
	[Permission.ChangeCustomerTags]: {
		description: "Allows the user to change a customer's tags.",
		category: 'customers'
	},
	// users
	[Permission.ManageSelf]: {
		description: 'Allows the user to manage their own account.',
		category: 'users'
	},
	[Permission.ManageUsers]: {
		description: 'Allows the user to manage other users.',
		category: 'users'
	},
	[Permission.ChangeUserLabels]: {
		description: 'Allows the user to change user labels of other users.',
		category: 'users'
	},
	// admin
	[Permission.ManageSettings]: {
		description: 'Allows the user to manage system settings.',
		category: 'admin'
	},
	[Permission.ToggleMaintenance]: {
		description: 'Allows the user to toggle maintenance mode.',
		category: 'admin'
	}
};

export const DEFAULT_PERMISSIONS: Record<Role, Permission[]> = {
	[Role.Agent]: [
		Permission.ReplyTicket,
		Permission.CreateTicket,
		Permission.OpenTicket,
		Permission.CreateTicketMessages,
		Permission.CloseTicket,
		Permission.ChangeLabels,
		Permission.AddEmail,
		Permission.RemoveEmail
	],
	[Role.Manager]: [
		Permission.ReplyTicket,
		Permission.CreateTicket,
		Permission.ManageTicket,
		Permission.OpenTicket,
		Permission.CloseTicket,
		Permission.ChangeLabels,
		Permission.ManageLabels,
		Permission.ManageTicketMessages,
		Permission.LinkIssue,
		Permission.AddEmail,
		Permission.RemoveEmail,
		Permission.ChangeCustomerName,
		Permission.ChangeCustomerTags,
		Permission.ManageSelf,
		Permission.ManageUsers
	],
	[Role.Admin]: Object.values(Permission)
};

export const ALL_ROLES = Object.values(Role);
