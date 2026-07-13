import { describe, expect, it } from 'vitest';
import {
	ALL_PERMISSIONS,
	ALL_ROLES,
	DEFAULT_PERMISSIONS,
	expandPermissions,
	Permission,
	PERMISSION_REQUIRES,
	Role
} from '~/shared/types/user';

describe('Role enum', () => {
	it('has the agent/manager/admin values', () => {
		expect(Role.Agent).toBe('agent');
		expect(Role.Manager).toBe('manager');
		expect(Role.Admin).toBe('admin');
		expect(ALL_ROLES).toEqual(['agent', 'manager', 'admin']);
	});
});

describe('ALL_PERMISSIONS', () => {
	it('documents every Permission with a description and a category', () => {
		for (const perm of Object.values(Permission)) {
			const data = ALL_PERMISSIONS[perm];
			expect(data).toBeDefined();
			expect(data.description.length).toBeGreaterThan(0);
			expect(['tickets', 'customers', 'users', 'admin']).toContain(data.category);
		}
	});
});

describe('DEFAULT_PERMISSIONS', () => {
	it('grants admins every permission', () => {
		expect(new Set(DEFAULT_PERMISSIONS[Role.Admin])).toEqual(new Set(Object.values(Permission)));
	});

	it('gives managers audit + user management but not maintenance', () => {
		const mgr = DEFAULT_PERMISSIONS[Role.Manager];
		expect(mgr).toContain(Permission.ViewAuditLog);
		expect(mgr).toContain(Permission.ManageUsers);
		expect(mgr).not.toContain(Permission.ToggleMaintenance);
	});

	it('keeps agents to a limited subset (no manage-users/settings/audit)', () => {
		const agent = DEFAULT_PERMISSIONS[Role.Agent];
		expect(agent).toContain(Permission.ReplyTicket);
		expect(agent).not.toContain(Permission.ManageUsers);
		expect(agent).not.toContain(Permission.ManageSettings);
		expect(agent).not.toContain(Permission.ViewAuditLog);
	});
});

describe('expandPermissions', () => {
	it('is a no-op for a permission with no prerequisites', () => {
		expect(expandPermissions([Permission.ReplyTicket])).toEqual([Permission.ReplyTicket]);
	});

	it('returns an empty list unchanged', () => {
		expect(expandPermissions([])).toEqual([]);
	});

	it.each([
		[Permission.ManageUsers, [Permission.ManageSelf]],
		[Permission.ManageTicketMessages, [Permission.CreateTicketMessages]],
		[Permission.ManageLabels, [Permission.ChangeLabels]],
		[Permission.TogglePrivate, [Permission.ViewPrivateTickets]],
		[Permission.LockThread, [Permission.ChatInLocked]]
	])('pulls in the direct prerequisite of %s', (perm, deps) => {
		const out = expandPermissions([perm]);
		expect(out).toContain(perm);
		for (const dep of deps) expect(out).toContain(dep);
	});

	it('follows a transitive chain (ChangeUserLabels -> ManageUsers -> ManageSelf)', () => {
		const out = expandPermissions([Permission.ChangeUserLabels]);
		expect(out).toEqual(
			expect.arrayContaining([
				Permission.ChangeUserLabels,
				Permission.ManageUsers,
				Permission.ManageSelf
			])
		);
	});

	it('is idempotent and deduplicates', () => {
		const once = expandPermissions([Permission.ChangeUserLabels]);
		const twice = expandPermissions(once);
		expect(new Set(twice)).toEqual(new Set(once));
		expect(twice.length).toBe(new Set(twice).size);
	});

	it('does not drop already-present prerequisites', () => {
		const out = expandPermissions([Permission.ManageUsers, Permission.ManageSelf]);
		expect(out.filter((p) => p === Permission.ManageSelf)).toHaveLength(1);
	});

	it('every PERMISSION_REQUIRES entry is satisfied after expansion', () => {
		for (const key of Object.keys(PERMISSION_REQUIRES) as Permission[]) {
			const out = expandPermissions([key]);
			for (const dep of PERMISSION_REQUIRES[key]!) expect(out).toContain(dep);
		}
	});
});
