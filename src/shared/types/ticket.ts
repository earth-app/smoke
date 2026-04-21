import type { Customer, Label, User } from './user';

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
	subject: string;
	description: string;
	status: TicketStatus;
	priority: TicketPriority;
	labels: Label[];
	created_at: Date;
	updated_at: Date;
	customer: Customer;
};

export type TicketThread = {
	ticket: Ticket;
	messages: TicketMessage[];
	users: User[];
};

export type TicketMessage = {
	id: number;
	ticket_id: number;
	reply_to?: number;
	sender: User | Customer;
	message: string;
	created_at: Date;
	attachments?: TicketAttachment[];
};

export type TicketAttachment = {
	id: number;
	ticket_id: number;
	data: ArrayBuffer;
	file_name: string;
	mimetype: string;
	created_at: Date;
};
