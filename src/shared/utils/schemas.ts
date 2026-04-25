import z from 'zod';

// primitives

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
	.max(512, 'Avatar URLs must be shorter than 512 characters')
	.optional();

// enums

export const role = z.enum(Object.values(Role));
export const permissions = z.array(z.enum(Object.values(Permission)));

// object

export const label = z
	.object({
		id: numId,
		name: z.string().max(48, 'Label name cannot be longer than 48 characters'),
		color: z.hex().optional()
	})
	.describe('A label that can be applied to users or customers for organizational purposes');

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
		labels: z.array(label)
	})
	.describe('A registered user that performs actions for customers');

// parameters

export const usernameParam = username.refine(
	(val) =>
		val !== 'current' && val.startsWith('@') && val.slice(1).length > 3 && val.slice(1).length < 64
);
