import z from 'zod';
import type { FlowConditionGroup } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';

const condition = z.object({
	field: z.enum(['title', 'description', 'status', 'priority', 'customer_email']),
	operator: z.enum([
		'contains',
		'equals',
		'matches',
		'not_contains',
		'starts_with',
		'ends_with',
		'gt',
		'lt',
		'in_list'
	]),
	value: z.string()
});

// leaf node inside a tree carries an optional discriminant tag
const treeLeaf = condition.extend({ kind: z.literal('condition').optional() });

// recursive boolean tree: a group matches all/any of its members, each a leaf or a nested group
const conditionTree: z.ZodType<FlowConditionGroup> = z.lazy(() =>
	z.object({
		kind: z.literal('group'),
		match: z.enum(['all', 'any']),
		conditions: z.array(z.union([conditionTree, treeLeaf]))
	})
);

const action = z.object({
	type: z.enum([
		'set_color',
		'set_priority',
		'set_status',
		'set_visibility',
		'assign',
		'set_project',
		'archive',
		'add_label',
		'set_icon',
		'lock_thread',
		'email_customer',
		'reply_in_thread'
	]),
	value: z.string(),
	ai: z.boolean().optional(),
	auto_send: z.boolean().optional(),
	identity: z.enum(['team', 'automation']).optional()
});

const body = z.object({
	name: z.string().min(1),
	enabled: z.boolean().optional(),
	trigger: z.enum([
		'ticket.created',
		'ticket.updated',
		'ticket.message',
		'ticket.deleted',
		'customer.created',
		'customer.added',
		'label.added',
		'label.removed',
		'assignee.added',
		'assignee.removed',
		'label.created',
		'label.updated',
		'label.deleted',
		'agent.created',
		'agent.updated',
		'agent.deleted'
	]),
	match: z.enum(['all', 'any']).optional(),
	conditions: z.array(condition).default([]),
	condition_tree: conditionTree.nullish(),
	actions: z.array(action).min(1)
});

export default defineEventHandler(async (event) => {
	const current = await ensureLoggedIn(event);
	if (!current.permissions.includes(Permission.ManageSettings)) {
		throw createError({
			statusCode: 403,
			message: 'You do not have permission to perform this action'
		});
	}

	const input = await readValidatedBody(event, body.parse);

	try {
		return await createFlow(input);
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'statusCode' in error) {
			throw error;
		}

		throw createError({
			statusCode: 500,
			message: 'Failed to create flow',
			data: { error: error instanceof Error ? error.message : String(error), success: false },
			stack: error instanceof Error ? error.stack : undefined
		});
	}
});
