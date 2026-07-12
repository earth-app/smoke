import { beforeAll, describe, expect, it } from 'vitest';
import { validateCustomFieldValues } from '~/server/utils/custom-fields';
import type { CustomFieldDef } from '~/shared/types/ticket';
import { Role } from '~/shared/types/user';
import { eventFor, getRuntime, importRoute, mockBody, seedAgent, seedUser } from './route-runtime';

// the server-utils barrel doesn't register the custom-fields util on globalThis; the routes
// reference its exports as nitro auto-imports, so wire them up for this suite
beforeAll(async () => {
	const customFields = await import('~/server/utils/custom-fields');
	for (const [key, value] of Object.entries(customFields)) {
		(globalThis as Record<string, unknown>)[key] = value;
	}
});

async function seedAdmin() {
	return await seedUser(getRuntime(), {
		username: 'admin',
		email: 'admin@example.com',
		role: Role.Admin
	});
}

describe('POST /api/custom-fields', () => {
	it('rejects a caller without ManageSettings', async () => {
		const agent = await seedAgent(getRuntime());
		const handler = await importRoute('~/server/api/custom-fields/index.post');
		mockBody({ fields: [{ label: 'Severity', type: 'text' }] });
		await expect(handler(eventFor(getRuntime().env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 403
		});
	});

	it('defines fields, deriving keys and keeping only select options', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/custom-fields/index.post');
		mockBody({
			fields: [
				{
					label: 'Severity Level',
					type: 'select',
					options: ['Low', 'High', 'High'],
					required: true
				},
				{ label: 'Notes', type: 'text', options: ['ignored'] }
			]
		});
		const saved = (await post(eventFor(getRuntime().env, admin.sessionToken))) as any[];
		expect(saved).toHaveLength(2);
		expect(saved[0].key).toBe('severity_level');
		expect(saved[0].options).toEqual(['Low', 'High']);
		expect(saved[0].required).toBe(true);
		expect(saved[1].type).toBe('text');
		expect(saved[1].options).toBeUndefined();
	});

	it('drops duplicate keys, keeping the first', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/custom-fields/index.post');
		mockBody({
			fields: [
				{ key: 'sev', label: 'One', type: 'text' },
				{ key: 'sev', label: 'Two', type: 'text' }
			]
		});
		const saved = (await post(eventFor(getRuntime().env, admin.sessionToken))) as any[];
		expect(saved).toHaveLength(1);
		expect(saved[0].label).toBe('One');
	});
});

describe('GET /api/custom-fields', () => {
	it('returns the saved definitions for any logged-in staff', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/custom-fields/index.post');
		mockBody({ fields: [{ label: 'Notes', type: 'text' }] });
		await post(eventFor(getRuntime().env, admin.sessionToken));

		const agent = await seedAgent(getRuntime());
		const get = await importRoute('~/server/api/custom-fields/index.get');
		const list = (await get(eventFor(getRuntime().env, agent.sessionToken))) as any[];
		expect(list).toHaveLength(1);
		expect(list[0].key).toBe('notes');
	});
});

describe('custom field types', () => {
	it('persists every new field type; reference + file carry no options/selection', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/custom-fields/index.post');
		mockBody({
			fields: [
				{
					label: 'Tags',
					type: 'multiselect',
					options: ['A', 'B', 'C'],
					selection: { rule: 'exactly', count: 2 }
				},
				{ label: 'Owner', type: 'account' },
				{ label: 'Linked Ticket', type: 'ticket' },
				{ label: 'Requester', type: 'customer' },
				{ label: 'Category', type: 'label' },
				{ label: 'Attachment', type: 'file' }
			]
		});
		const saved = (await post(eventFor(getRuntime().env, admin.sessionToken))) as any[];
		expect(saved.map((field) => field.type)).toEqual([
			'multiselect',
			'account',
			'ticket',
			'customer',
			'label',
			'file'
		]);
		expect(saved[0].options).toEqual(['A', 'B', 'C']);
		expect(saved[0].selection).toEqual({ rule: 'exactly', count: 2 });
		for (const field of saved.slice(1)) {
			expect(field.options).toBeUndefined();
			expect(field.selection).toBeUndefined();
		}

		// round-trips through kv on read
		const get = await importRoute('~/server/api/custom-fields/index.get');
		const list = (await get(eventFor(getRuntime().env, admin.sessionToken))) as any[];
		expect(list).toHaveLength(6);
		expect(list[0].selection).toEqual({ rule: 'exactly', count: 2 });
		expect(list[5].type).toBe('file');
	});

	it('normalizes multiselect selection rules and defaults the count', async () => {
		const admin = await seedAdmin();
		const post = await importRoute('~/server/api/custom-fields/index.post');
		mockBody({
			fields: [
				{ label: 'Any', type: 'multiselect', options: ['x'], selection: { rule: 'any', count: 3 } },
				{ label: 'All', type: 'multiselect', options: ['x'], selection: { rule: 'all' } },
				{ label: 'AtLeast', type: 'multiselect', options: ['x'], selection: { rule: 'at_least' } },
				{ label: 'Bad', type: 'multiselect', options: ['x'], selection: { rule: 'nope' } }
			]
		});
		const saved = (await post(eventFor(getRuntime().env, admin.sessionToken))) as any[];
		// any/all drop the count; a counted rule with a missing count defaults to 1; bad rule falls back to any
		expect(saved[0].selection).toEqual({ rule: 'any' });
		expect(saved[1].selection).toEqual({ rule: 'all' });
		expect(saved[2].selection).toEqual({ rule: 'at_least', count: 1 });
		expect(saved[3].selection).toEqual({ rule: 'any' });
	});
});

describe('validateCustomFieldValues', () => {
	const def = (over: Partial<CustomFieldDef>): CustomFieldDef => ({
		key: 'f',
		label: 'F',
		type: 'text',
		...over
	});

	it('no-ops on empty defs', () => {
		expect(() => validateCustomFieldValues([], { f: 'x' })).not.toThrow();
	});

	it('rejects a missing required value', () => {
		expect(() => validateCustomFieldValues([def({ required: true })], {})).toThrow();
		expect(() => validateCustomFieldValues([def({ required: true })], { f: '   ' })).toThrowError(
			/required/
		);
	});

	it('allows an empty optional value', () => {
		expect(() => validateCustomFieldValues([def({})], {})).not.toThrow();
	});

	it('rejects an unknown select option', () => {
		const select = def({ type: 'select', options: ['a', 'b'] });
		expect(() => validateCustomFieldValues([select], { f: 'c' })).toThrow();
		expect(() => validateCustomFieldValues([select], { f: 'a' })).not.toThrow();
	});

	it('rejects an unknown multiselect option', () => {
		const ms = def({ type: 'multiselect', options: ['a', 'b', 'c'] });
		expect(() => validateCustomFieldValues([ms], { f: 'a,z' })).toThrow();
		expect(() => validateCustomFieldValues([ms], { f: 'a,b' })).not.toThrow();
	});

	it('enforces the exactly rule', () => {
		const ms = def({
			type: 'multiselect',
			options: ['a', 'b', 'c'],
			selection: { rule: 'exactly', count: 2 }
		});
		expect(() => validateCustomFieldValues([ms], { f: 'a' })).toThrowError(/exactly 2/);
		expect(() => validateCustomFieldValues([ms], { f: 'a,b,c' })).toThrow();
		expect(() => validateCustomFieldValues([ms], { f: 'a,b' })).not.toThrow();
	});

	it('enforces the at_least rule', () => {
		const ms = def({
			type: 'multiselect',
			options: ['a', 'b', 'c'],
			selection: { rule: 'at_least', count: 2 }
		});
		expect(() => validateCustomFieldValues([ms], { f: 'a' })).toThrowError(/at least 2/);
		expect(() => validateCustomFieldValues([ms], { f: 'a,b' })).not.toThrow();
		expect(() => validateCustomFieldValues([ms], { f: 'a,b,c' })).not.toThrow();
	});

	it('enforces the up_to rule', () => {
		const ms = def({
			type: 'multiselect',
			options: ['a', 'b', 'c'],
			selection: { rule: 'up_to', count: 2 }
		});
		expect(() => validateCustomFieldValues([ms], { f: 'a,b,c' })).toThrowError(/up to 2/);
		expect(() => validateCustomFieldValues([ms], { f: 'a,b' })).not.toThrow();
		expect(() => validateCustomFieldValues([ms], { f: 'a' })).not.toThrow();
	});

	it('enforces the all rule', () => {
		const ms = def({
			type: 'multiselect',
			options: ['a', 'b', 'c'],
			selection: { rule: 'all' }
		});
		expect(() => validateCustomFieldValues([ms], { f: 'a,b' })).toThrow();
		expect(() => validateCustomFieldValues([ms], { f: 'a,b,c' })).not.toThrow();
	});

	it('accepts any count under the any rule', () => {
		const ms = def({
			type: 'multiselect',
			options: ['a', 'b', 'c'],
			selection: { rule: 'any' }
		});
		expect(() => validateCustomFieldValues([ms], { f: '' })).not.toThrow();
		expect(() => validateCustomFieldValues([ms], { f: 'a,b,c' })).not.toThrow();
	});

	it('sets a 400 status on violations', () => {
		expect.assertions(1);
		try {
			validateCustomFieldValues([def({ required: true })], {});
		} catch (error) {
			expect((error as { statusCode?: number }).statusCode).toBe(400);
		}
	});
});
