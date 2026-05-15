import type { User } from './user';

export enum TicketStatus {
	Submitted = 'submitted',
	Open = 'open',
	Pending = 'pending',
	WorkInProgress = 'work_in_progress',
	Closed = 'closed',
	WontFix = 'wont_fix'
}

export enum TicketPriority {
	None = 'none',
	Low = 'low',
	Medium = 'medium',
	High = 'high',
	Critical = 'critical'
}

export type Ticket = {
	id: number;
	title: string;
	description: string;
	status: TicketStatus;
	priority: TicketPriority;
	labels: number[];
	customer_id: number;
	assignees: User[];
	created_at: Date;
	updated_at: Date;
};

export type TicketActor =
	| {
			kind: 'user';
			id: string;
			username: string;
			email?: string;
			name?: string;
			avatar_url?: string;
	  }
	| {
			kind: 'customer';
			id: number;
			email?: string;
			name?: string;
			avatar_url?: string;
	  };

export type TicketAttachment = {
	id: number;
	ticket_id: number;
	data: string;
	file_name: string;
	mimetype: string;
	created_at: Date;
};

export type TicketAttachmentInput = Omit<TicketAttachment, 'id' | 'ticket_id' | 'created_at'>;

export type TicketMessageInput = {
	message: string;
	sender: TicketActor;
	reply_to?: number;
	attachments?: TicketAttachmentInput[];
};

export type TicketCreateInput = {
	title: string;
	description: string;
	customer_id: number;
	status?: TicketStatus;
	priority?: TicketPriority;
	labels?: number[];
	assignee_ids?: string[];
};

export type TicketPatchInput = Partial<TicketCreateInput>;

export type TicketThread = {
	ticket: Ticket;
	messages: TicketMessage[];
	users: Array<User | TicketActor>;
};

export type TicketMessage = {
	id: number;
	ticket_id: number;
	reply_to?: number;
	sender: TicketActor;
	message: string;
	created_at: Date;
	attachments?: TicketAttachment[];
};
