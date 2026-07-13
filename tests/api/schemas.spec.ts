import { describe, expect, it } from 'vitest';
import { TicketPriority, TicketStatus, TicketVisibility } from '~/shared/types/ticket';
import { Permission, Role } from '~/shared/types/user';
import {
	avatar_icon,
	avatar_url,
	colorValue,
	customerCreateBody,
	customerIdParam,
	customerPatchBody,
	email,
	firstName,
	id,
	label,
	labelCreateBody,
	labelIdParam,
	labelPatchBody,
	lastName,
	numId,
	PASSWORD_SPECIAL,
	passwordParam,
	permissions,
	role,
	ticketActor,
	ticketAttachment,
	ticketCreateBody,
	ticketIdParam,
	ticketMessageCreateBody,
	ticketMessageIdParam,
	ticketPatchBody,
	ticketPriority,
	ticketStatus,
	ticketVisibility,
	user,
	userCreateBody,
	userIdParam,
	username,
	usernameParam,
	userPatchBody
} from '~/shared/utils/schemas';

// schemas.ts hardcodes the enum values (it can't read Object.values(Enum) at module-eval:
// nuxt auto-imports make shared/types import schemas back, so touching the enum objects there
// tdz-crashes and 500s every ssr route). these tests fail if the hardcoded lists drift from the
// source enums, matching the compile-time `satisfies` guards in schemas.ts at runtime.
describe('shared enum schemas stay in sync with the source enums', () => {
	it('role accepts exactly the Role values', () => {
		expect(new Set(role.options)).toEqual(new Set(Object.values(Role)));
		for (const value of Object.values(Role)) expect(role.parse(value)).toBe(value);
		expect(() => role.parse('emperor')).toThrow();
	});

	it('ticketStatus accepts exactly the TicketStatus values', () => {
		expect(new Set(ticketStatus.options)).toEqual(new Set(Object.values(TicketStatus)));
		expect(() => ticketStatus.parse('deferred')).toThrow();
	});

	it('ticketPriority accepts exactly the TicketPriority values', () => {
		expect(new Set(ticketPriority.options)).toEqual(new Set(Object.values(TicketPriority)));
		expect(() => ticketPriority.parse('urgent')).toThrow();
	});

	it('ticketVisibility accepts exactly the TicketVisibility values', () => {
		expect(new Set(ticketVisibility.options)).toEqual(new Set(Object.values(TicketVisibility)));
		expect(() => ticketVisibility.parse('secret')).toThrow();
	});

	it('permissions accepts every Permission value and rejects unknown ones', () => {
		const all = Object.values(Permission);
		expect(permissions.parse(all)).toEqual(all);
		expect(permissions.parse([])).toEqual([]);
		expect(() => permissions.parse(['reply_ticket', 'not_a_real_permission'])).toThrow();
	});
});

// router params arrive as strings, so every numeric id param must coerce (else routes 400 in prod
// even though unit tests pass, since the harness mockParams bypasses the schema)
describe('numeric id route params coerce a string to a number', () => {
	it.each([
		['customerIdParam', customerIdParam],
		['labelIdParam', labelIdParam],
		['ticketIdParam', ticketIdParam]
	])('%s parses "1" to 1 and rejects non-positive / non-numeric', (_name, schema) => {
		expect(schema.parse('1')).toBe(1);
		expect(schema.parse(42)).toBe(42);
		expect(() => schema.parse('0')).toThrow();
		expect(() => schema.parse('-3')).toThrow();
		expect(() => schema.parse('abc')).toThrow();
	});

	it('ticketMessageIdParam allows zero (nonnegative) but not negatives', () => {
		expect(ticketMessageIdParam.parse('0')).toBe(0);
		expect(ticketMessageIdParam.parse('5')).toBe(5);
		expect(() => ticketMessageIdParam.parse('-1')).toThrow();
		expect(() => ticketMessageIdParam.parse('1.5')).toThrow();
	});
});

const ID = 'a'.repeat(32);

describe('colorValue', () => {
	it('accepts #rgb and #rrggbb (any case)', () => {
		for (const c of ['#fff', '#FFF', '#3b82f6', '#ABCDEF']) expect(colorValue.parse(c)).toBe(c);
	});

	it('accepts every nuxt ui theme token', () => {
		for (const t of ['primary', 'secondary', 'success', 'info', 'warning', 'error', 'neutral'])
			expect(colorValue.parse(t)).toBe(t);
	});

	it('rejects partial hex, non-hex chars, rgb(), and unknown tokens', () => {
		expect(() => colorValue.parse('#12')).toThrow();
		expect(() => colorValue.parse('#12345')).toThrow();
		expect(() => colorValue.parse('#gggggg')).toThrow();
		expect(() => colorValue.parse('rgb(0,0,0)')).toThrow();
		expect(() => colorValue.parse('blurple')).toThrow();
		expect(() => colorValue.parse('')).toThrow();
	});
});

describe('PASSWORD_SPECIAL', () => {
	it('matches ascii punctuation across every sub-range', () => {
		for (const ch of ['!', '/', ':', '@', '[', '`', '{', '~', '^', '+', '=', ';', '?', '(', ')'])
			expect(PASSWORD_SPECIAL.test(ch)).toBe(true);
	});

	it('does not match letters or digits', () => {
		expect(PASSWORD_SPECIAL.test('a')).toBe(false);
		expect(PASSWORD_SPECIAL.test('Z')).toBe(false);
		expect(PASSWORD_SPECIAL.test('5')).toBe(false);
	});
});

describe('passwordParam', () => {
	it('accepts a 12+ char password with all four character classes', () => {
		expect(passwordParam.parse('Password123!')).toBe('Password123!');
		expect(passwordParam.parse('aB3~xxxxxxxxx')).toBe('aB3~xxxxxxxxx');
	});

	it('rejects a password under the 12-char floor', () => {
		expect(() => passwordParam.parse('Ab3!xxxx')).toThrow();
	});

	it('rejects a password over 128 chars', () => {
		expect(() => passwordParam.parse('Ab3!' + 'x'.repeat(130))).toThrow();
	});

	it('rejects when a required character class is missing', () => {
		expect(() => passwordParam.parse('password123!')).toThrow();
		expect(() => passwordParam.parse('PASSWORD123!')).toThrow();
		expect(() => passwordParam.parse('Passwordabc!')).toThrow();
		expect(() => passwordParam.parse('Password1234')).toThrow();
	});
});

describe('primitive schemas', () => {
	it('id requires exactly 32 alphanumeric chars', () => {
		expect(id.parse(ID)).toBe(ID);
		expect(() => id.parse('a'.repeat(31))).toThrow();
		expect(() => id.parse('a'.repeat(33))).toThrow();
		expect(() => id.parse('!'.repeat(32))).toThrow();
	});

	it('numId accepts any number', () => {
		expect(numId.parse(0)).toBe(0);
		expect(numId.parse(-7)).toBe(-7);
		expect(() => numId.parse('5')).toThrow();
	});

	it('username enforces length and the allowed charset', () => {
		expect(username.parse('admin')).toBe('admin');
		expect(username.parse('a_$%~.<>1')).toBe('a_$%~.<>1');
		expect(() => username.parse('ab')).toThrow();
		expect(() => username.parse('has space')).toThrow();
		expect(() => username.parse('bad@char')).toThrow();
	});

	it('email accepts a valid address and rejects junk / overlong', () => {
		expect(email.parse('a@b.com')).toBe('a@b.com');
		expect(() => email.parse('nope')).toThrow();
		expect(() => email.parse('a@' + 'b'.repeat(130) + '.com')).toThrow();
	});

	it('avatar_url requires https and is optional', () => {
		expect(avatar_url.parse(undefined)).toBeUndefined();
		expect(avatar_url.parse('https://x.com/a.png')).toBe('https://x.com/a.png');
		expect(() => avatar_url.parse('http://x.com/a.png')).toThrow();
		expect(() => avatar_url.parse('not a url')).toThrow();
	});

	it('avatar_icon accepts an iconify name and rejects a leading symbol', () => {
		expect(avatar_icon.parse('mdi:robot')).toBe('mdi:robot');
		expect(() => avatar_icon.parse('')).toThrow();
		expect(() => avatar_icon.parse(':bad')).toThrow();
	});

	it('firstName / lastName enforce 1-64 chars', () => {
		expect(firstName.parse('Ada')).toBe('Ada');
		expect(lastName.parse('Lovelace')).toBe('Lovelace');
		expect(() => firstName.parse('')).toThrow();
		expect(() => lastName.parse('x'.repeat(65))).toThrow();
	});
});

describe('label schemas', () => {
	it('label object parses with an optional color', () => {
		expect(label.parse({ id: 1, name: 'Bug', color: '#f00' })).toMatchObject({ name: 'Bug' });
		expect(label.parse({ id: 2, name: 'Billing' })).toMatchObject({ id: 2 });
	});

	it('labelCreateBody requires a non-empty name', () => {
		expect(labelCreateBody.parse({ name: 'Feature' })).toEqual({ name: 'Feature' });
		expect(() => labelCreateBody.parse({ name: '' })).toThrow();
		expect(() => labelCreateBody.parse({ name: 'x'.repeat(49) })).toThrow();
	});

	it('labelPatchBody allows a lone color and rejects a bad color', () => {
		expect(labelPatchBody.parse({ color: 'primary' })).toEqual({ color: 'primary' });
		expect(() => labelPatchBody.parse({ color: 'nope' })).toThrow();
	});
});

describe('customer body schemas', () => {
	it('customerCreateBody makes email optional', () => {
		expect(customerCreateBody.parse({})).toEqual({});
		expect(customerCreateBody.parse({ email: 'a@b.com', name: 'Al' })).toMatchObject({
			name: 'Al'
		});
	});

	it('customerPatchBody rejects a bad email and an empty name', () => {
		expect(() => customerPatchBody.parse({ email: 'bad' })).toThrow();
		expect(() => customerPatchBody.parse({ name: '' })).toThrow();
	});
});

describe('user schemas', () => {
	it('user parses a full record', () => {
		const now = new Date();
		const parsed = user.parse({
			id: ID,
			username: 'admin',
			email: 'a@b.com',
			role: 'admin',
			permissions: ['reply_ticket'],
			created_at: now,
			updated_at: now,
			labels: []
		});
		expect(parsed.username).toBe('admin');
	});

	it('userCreateBody requires username + email', () => {
		expect(userCreateBody.parse({ username: 'admin', email: 'a@b.com' })).toEqual({
			username: 'admin',
			email: 'a@b.com'
		});
		expect(() => userCreateBody.parse({ username: 'admin' })).toThrow();
	});

	it('userPatchBody requires a first name when a last name is set', () => {
		expect(userPatchBody.parse({ first_name: 'Ada' })).toMatchObject({ first_name: 'Ada' });
		expect(userPatchBody.parse({ first_name: 'Ada', last_name: 'Lovelace' })).toMatchObject({
			last_name: 'Lovelace'
		});
		expect(() => userPatchBody.parse({ last_name: 'Lovelace' })).toThrow();
	});

	it('userPatchBody accepts an empty patch', () => {
		expect(userPatchBody.parse({})).toEqual({});
	});
});

describe('user identifier params', () => {
	it('userIdParam accepts a 32-char id or the literal "current"', () => {
		expect(userIdParam.parse(ID)).toBe(ID);
		expect(userIdParam.parse('current')).toBe('current');
	});

	it('userIdParam rejects a short arbitrary string', () => {
		expect(() => userIdParam.parse('admin')).toThrow();
	});

	// the base username charset excludes '@', so usernameParam never matches an "@name" input
	it('usernameParam rejects "current" and a name without a leading @', () => {
		expect(usernameParam.safeParse('current').success).toBe(false);
		expect(usernameParam.safeParse('admin').success).toBe(false);
	});
});

describe('ticketActor discriminated union', () => {
	it('parses a user actor', () => {
		const parsed = ticketActor.parse({ kind: 'user', id: ID, username: 'agent1' });
		expect(parsed).toMatchObject({ kind: 'user', username: 'agent1' });
	});

	it('parses a customer actor and coerces its numeric id', () => {
		const parsed = ticketActor.parse({ kind: 'customer', id: '7' });
		expect(parsed).toMatchObject({ kind: 'customer', id: 7 });
	});

	it('rejects an unknown kind and a user actor missing its id', () => {
		expect(() => ticketActor.parse({ kind: 'robot', id: ID })).toThrow();
		expect(() => ticketActor.parse({ kind: 'user', username: 'x' })).toThrow();
	});
});

describe('ticketAttachment', () => {
	it('requires all three fields', () => {
		expect(
			ticketAttachment.parse({ file_name: 'a.txt', mimetype: 'text/plain', data: 'x' })
		).toMatchObject({ file_name: 'a.txt' });
		expect(() => ticketAttachment.parse({ file_name: 'a.txt', mimetype: 'text/plain' })).toThrow();
		expect(() =>
			ticketAttachment.parse({ file_name: '', mimetype: 'text/plain', data: 'x' })
		).toThrow();
	});
});

describe('ticket body schemas', () => {
	it('ticketCreateBody requires a title + description and coerces customer_id', () => {
		const parsed = ticketCreateBody.parse({
			title: 'Broken',
			description: 'It broke',
			customer_id: '3'
		});
		expect(parsed).toMatchObject({ title: 'Broken', customer_id: 3 });
		expect(() => ticketCreateBody.parse({ description: 'no title' })).toThrow();
		expect(() => ticketCreateBody.parse({ title: '', description: 'x' })).toThrow();
	});

	it('ticketCreateBody accepts the shared meta shape', () => {
		const parsed = ticketCreateBody.parse({
			title: 'T',
			description: 'D',
			visibility: 'internal',
			source: 'team',
			color: '#abc',
			icon: 'mdi:bug',
			project_ids: ['2', 4],
			custom_fields: { region: 'us' }
		});
		expect(parsed.project_ids).toEqual([2, 4]);
		expect(parsed.visibility).toBe('internal');
	});

	it('ticketCreateBody rejects a bad meta color and an unknown source', () => {
		expect(() => ticketCreateBody.parse({ title: 'T', description: 'D', color: 'red' })).toThrow();
		expect(() =>
			ticketCreateBody.parse({ title: 'T', description: 'D', source: 'carrier-pigeon' })
		).toThrow();
	});

	it('ticketPatchBody allows an empty patch and the archived flag', () => {
		expect(ticketPatchBody.parse({})).toEqual({});
		expect(ticketPatchBody.parse({ archived: false })).toEqual({ archived: false });
	});
});

describe('ticketMessageCreateBody', () => {
	it('requires a message body', () => {
		expect(ticketMessageCreateBody.parse({ message: 'hi' })).toMatchObject({ message: 'hi' });
		expect(() => ticketMessageCreateBody.parse({ message: '' })).toThrow();
	});

	it('accepts an identity, cc list, and attachments', () => {
		const parsed = ticketMessageCreateBody.parse({
			message: 'hi',
			identity: 'team',
			cc: ['a@b.com', 'c@d.com']
		});
		expect(parsed.identity).toBe('team');
		expect(parsed.cc).toHaveLength(2);
	});

	it('rejects an over-long cc list and a bad cc address', () => {
		expect(() =>
			ticketMessageCreateBody.parse({
				message: 'hi',
				cc: Array.from({ length: 21 }, (_, i) => `a${i}@b.com`)
			})
		).toThrow();
		expect(() => ticketMessageCreateBody.parse({ message: 'hi', cc: ['nope'] })).toThrow();
	});
});
