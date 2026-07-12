import type { Role, User } from './user';

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

// public = listed + customer-viewable via status token; internal = any staff; private = perms/assignee
export enum TicketVisibility {
	Public = 'public',
	Internal = 'internal',
	Private = 'private'
}

// where a ticket originated; drives the default visibility from settings
export type TicketSource = 'guest' | 'emailed' | 'team';

export type Ticket = {
	id: number;
	title: string;
	description: string;
	status: TicketStatus;
	priority: TicketPriority;
	labels: number[];
	customer_id: number;
	private: boolean;
	visibility: TicketVisibility;
	color?: string | null;
	// iconify icon name (e.g. mdi:bug); paired with color for the ticket's visual identity
	icon?: string | null;
	deadline?: Date | null;
	// legacy single project; project_ids is the source of truth (project_id = project_ids[0])
	project_id?: number | null;
	project_ids?: number[];
	custom_fields?: Record<string, string>;
	// staff user id who opened the ticket (customer-less/internal tickets); display falls back to this
	created_by?: string | null;
	// conversation locked (github-issue style); independent of archival/status
	locked?: boolean;
	// soft-archived by retention; hidden from default lists but still viewable
	archived?: boolean;
	archived_at?: Date | null;
	// extra emails (cc'd / forwarded) granted view+reply access to this ticket; normalized lowercase
	participants?: string[];
	assignees: User[];
	created_at: Date;
	updated_at: Date;
};

// a group of tickets (github-projects style); stored in kv, definitions managed in settings
export type Project = {
	id: number;
	name: string;
	description?: string;
	color?: string;
	created_at: Date;
};

// a configurable custom field definition (trello-like); stored in settings kv.
// reference types (account/ticket/customer/label) store the target id as the value; file stores a
// blob key; multiselect stores a comma-joined list of option values
export type CustomFieldType =
	| 'text'
	| 'number'
	| 'select'
	| 'multiselect'
	| 'date'
	| 'checkbox'
	| 'account'
	| 'ticket'
	| 'customer'
	| 'label'
	| 'file';
// how many options a multiselect requires: any number, at least/exactly/up to N, or all of them
export type MultiSelectRule = 'any' | 'at_least' | 'exactly' | 'up_to' | 'all';
export type CustomFieldDef = {
	key: string;
	label: string;
	type: CustomFieldType;
	options?: string[];
	required?: boolean;
	// multiselect-only: the selection-count rule (+ count for at_least/exactly/up_to)
	selection?: { rule: MultiSelectRule; count?: number };
};

// event-driven automation rule (trello-automation style); stored in kv
export type FlowTrigger =
	| 'ticket.created'
	| 'ticket.updated'
	| 'ticket.message'
	| 'ticket.deleted'
	| 'customer.created'
	| 'customer.added'
	| 'label.added'
	| 'label.removed'
	| 'assignee.added'
	| 'assignee.removed'
	| 'label.created'
	| 'label.updated'
	| 'label.deleted'
	| 'agent.created'
	| 'agent.updated'
	| 'agent.deleted';
export type FlowConditionField = 'title' | 'description' | 'status' | 'priority' | 'customer_email';
export type FlowOperator =
	| 'contains'
	| 'equals'
	| 'matches'
	| 'not_contains'
	| 'starts_with'
	| 'ends_with'
	| 'gt'
	| 'lt'
	| 'in_list';
export type FlowCondition = { field: FlowConditionField; operator: FlowOperator; value: string };

// a boolean condition tree: a group matches all/any of its members, each of which is either a
// leaf condition or a nested group - enabling `a AND (b OR c)`, `(a AND b) OR (c AND d)`, etc.
// arbitrary depth. legacy flat `conditions[]` + `match` on a flow still work as a single group.
export type FlowConditionNode = ({ kind?: 'condition' } & FlowCondition) | FlowConditionGroup;
export type FlowConditionGroup = {
	kind: 'group';
	match: 'all' | 'any';
	conditions: FlowConditionNode[];
};
export type FlowActionType =
	| 'set_color'
	| 'set_priority'
	| 'set_status'
	| 'set_visibility'
	| 'assign'
	| 'set_project'
	| 'archive'
	| 'add_label'
	| 'set_icon'
	| 'lock_thread'
	| 'email_customer'
	| 'reply_in_thread';
// value carries the action target; message actions carry the body + ai/auto-send/identity options
export type FlowAction = {
	type: FlowActionType;
	value: string;
	ai?: boolean;
	auto_send?: boolean;
	identity?: 'team' | 'automation';
};
export type TicketFlow = {
	id: number;
	name: string;
	enabled: boolean;
	trigger: FlowTrigger;
	match: 'all' | 'any';
	conditions: FlowCondition[];
	// optional nested boolean tree; when present it supersedes the flat conditions/match
	condition_tree?: FlowConditionGroup;
	actions: FlowAction[];
};

// a customer reference handed to the flow engine for customer.* triggers
export type FlowCustomer = { id: number; email?: string; name?: string };

// extra context handed to the flow engine per trigger family
export type FlowLabelRef = { id: number; name: string; color?: string };
export type FlowAssigneeRef = { id: string; username: string; name?: string };
export type FlowAgentRef = { id: string; username: string; name?: string; role?: Role };

// the snapshot handed to the flow engine when an event fires; ticket is absent for customer.created
// + label.created/updated/deleted + agent.* triggers
export type FlowEvent = {
	trigger: FlowTrigger;
	ticket?: Ticket;
	customer?: FlowCustomer;
	customer_email?: string;
	// label.added/removed (on a ticket) + label.created/updated/deleted
	label?: FlowLabelRef;
	// assignee.added/removed (on a ticket)
	assignee?: FlowAssigneeRef;
	// agent.created/updated/deleted
	agent?: FlowAgentRef;
};

export type TicketActor =
	| {
			kind: 'user';
			id: string;
			username: string;
			email?: string;
			name?: string;
			avatar_url?: string;
			// role tag + ai tag shown next to the name in the thread
			role?: Role;
			ai?: boolean;
	  }
	| {
			kind: 'customer';
			id: number;
			email?: string;
			name?: string;
			avatar_url?: string;
	  };

// github-issue-style timeline event interleaved with messages in the thread (kept in kv, not the
// encrypted messages array, so it never perturbs the message id===index invariant)
export type TicketEventKind =
	| 'created'
	| 'renamed'
	| 'status'
	| 'priority'
	| 'visibility'
	| 'deadline'
	| 'color'
	| 'icon'
	| 'label_added'
	| 'label_removed'
	| 'assignee_added'
	| 'assignee_removed'
	| 'project_added'
	| 'project_removed'
	| 'locked'
	| 'unlocked'
	| 'archived'
	| 'unarchived'
	| 'closed'
	| 'reopened'
	| 'customer_changed';

export type TicketEvent = {
	id: string;
	kind: TicketEventKind;
	actor?: TicketActor;
	from?: string;
	to?: string;
	// a human label for the changed entity (a label name, assignee name, project name)
	label?: string;
	// set when a flow automated this change so the ui can render "by <flow name>"
	flow_id?: number;
	flow_name?: string;
	created_at: Date;
};

// a prior version of a message body, newest-last, surfaced for edit-history diffing
export type TicketMessageVersion = {
	message: string;
	edited_at: Date;
	edited_by?: string | null;
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
	// force message visibility (e.g. AI drafts posted as internal); defaults to the ticket's private flag
	private?: boolean;
};

export type TicketCreateInput = {
	title: string;
	description: string;
	// 0 or omitted => a customer-less internal ticket (e.g. bug tracking)
	customer_id?: number;
	status?: TicketStatus;
	priority?: TicketPriority;
	labels?: number[];
	assignee_ids?: string[];
	private?: boolean;
	visibility?: TicketVisibility;
	source?: TicketSource;
	color?: string | null;
	icon?: string | null;
	deadline?: Date | string | null;
	project_id?: number | null;
	project_ids?: number[];
	custom_fields?: Record<string, string>;
	locked?: boolean;
	archived?: boolean;
	// staff user id who opened this ticket (set by the dashboard create route)
	created_by?: string | null;
};

export type TicketPatchInput = Partial<TicketCreateInput>;

// per-ticket metadata kept in kv (no db migration); merged into Ticket on hydrate
export type TicketMeta = {
	visibility?: TicketVisibility;
	color?: string | null;
	icon?: string | null;
	deadline?: string | null;
	project_id?: number | null;
	project_ids?: number[];
	custom_fields?: Record<string, string>;
	locked?: boolean;
	archived?: boolean;
	archived_at?: string | null;
	created_by?: string | null;
	// normalized lowercase emails granted access to this ticket (cc'd / forwarded participants)
	participants?: string[];
};

export type TicketThread = {
	ticket: Ticket;
	messages: TicketMessage[];
	users: Array<User | TicketActor>;
	// timeline events (renames/field changes/etc), interleaved with messages by created_at on the client
	events?: TicketEvent[];
};

export type TicketMessage = {
	id: number;
	ticket_id: number;
	reply_to?: number;
	sender: TicketActor;
	sender_id: string;
	private: boolean;
	message: string;
	created_at: Date;
	edited_at?: Date | null;
	// staff user id of a DIFFERENT staff member who edited this message (absent when the author
	// edits their own); drives the "edited by <name>" marker in the thread
	edited_by?: string | null;
	attachments?: TicketAttachment[];
	// prior versions (newest-last) for the edit-history diff view; absent when never edited
	edit_history?: TicketMessageVersion[];
};
