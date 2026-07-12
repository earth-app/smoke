import type { ContextMenuItem } from '@nuxt/ui';
import type { CommandItem } from '~/composables/useCommands';
import type { Ticket } from '~/shared/types/ticket';
import type { Customer, Label, User } from '~/shared/types/user';
import type { AuditEntry } from '~/stores/audit';

// #region page menu

// page-scoped extra context-menu sections, merged into the layout's generic menu
export function usePageMenu() {
	return useState<ContextMenuItem[][]>('smoke:page-menu', () => []);
}

export function setPageMenu(getter: () => ContextMenuItem[][]) {
	if (!import.meta.client) return;
	const items = usePageMenu();
	watchEffect(() => {
		items.value = getter();
	});
	onScopeDispose(() => {
		items.value = [];
	});
}

// #endregion

// #region entity menus

type Section = ContextMenuItem[];

// 'ticket.message_added' -> 'Ticket Message Added'
function prettyAction(action: string): string {
	return action
		.split(/[._]/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

// per-entity right-click menus; role-gated by omission (matching the app's isAdmin || can(perm) idiom)
// so the same builders feed every row/card. callbacks are optional per surface (edit/delete/refresh)
export function useEntityMenus() {
	const auth = useAuth();
	const toast = useToast();
	const commands = useCommands();
	const palette = useCommandPalette();
	const route = useRoute();
	const allow = (permission: Permission) => auth.isAdmin.value || auth.can(permission);

	const origin = () => (import.meta.client ? window.location.origin : '');

	const copy = async (text: string, what: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast.add({
				title: `${what} Copied`,
				icon: 'mdi:content-copy',
				color: 'success',
				duration: 2000
			});
		} catch {
			toast.add({
				title: 'Copy Failed',
				description: text,
				icon: 'mdi:alert-circle',
				color: 'error',
				duration: 4000
			});
		}
	};

	// ticket row/card: open + copy, plus manager quick-patches (status/priority) via the store
	const ticketMenu = (ticket: Ticket, opts?: { onChanged?: () => void }): ContextMenuItem[][] => {
		const store = useTicketStore();
		const path = `/dashboard/tickets/${ticket.id}`;

		const patch = async (body: Record<string, unknown>, label: string) => {
			try {
				await store.patchTicket(ticket.id, body);
				toast.add({ title: label, icon: 'mdi:check', color: 'success', duration: 2000 });
				opts?.onChanged?.();
			} catch (error) {
				toast.add({
					title: 'Update Failed',
					description: extractServerMessage(error, 'Could not update the ticket.'),
					icon: 'mdi:alert-circle',
					color: 'error',
					duration: 4000
				});
			}
		};

		const primary: Section = [
			{ label: 'Open', icon: 'mdi:open-in-new', to: path },
			{
				label: 'Copy Link',
				icon: 'mdi:link-variant',
				onSelect: () => copy(`${origin()}${path}`, 'Link')
			}
		];

		const manage: Section = [];
		if (allow(Permission.ManageTicket)) {
			manage.push({
				label: 'Change Status',
				icon: 'mdi:progress-check',
				children: statusSelectItems().map((s) => ({
					label: s.label,
					icon: s.icon,
					onSelect: () => patch({ status: s.value }, `Status set to ${s.label}`)
				}))
			});
			manage.push({
				label: 'Change Priority',
				icon: 'mdi:flag-outline',
				children: prioritySelectItems().map((p) => ({
					label: p.label,
					icon: p.icon,
					onSelect: () => patch({ priority: p.value }, `Priority set to ${p.label}`)
				}))
			});
		}
		if (allow(Permission.ManageTicket)) {
			manage.push({
				label: ticket.archived ? 'Unarchive' : 'Archive',
				icon: ticket.archived ? 'mdi:archive-arrow-up-outline' : 'mdi:archive-outline',
				onSelect: () =>
					patch({ archived: !ticket.archived }, ticket.archived ? 'Unarchived' : 'Archived')
			});
		}

		return manage.length ? [primary, manage] : [primary];
	};

	// customer row/card
	const customerMenu = (
		customer: Customer,
		opts?: { onEditTags?: () => void }
	): ContextMenuItem[][] => {
		const path = `/dashboard/customers/${customer.id}`;
		const primary: Section = [{ label: 'Open', icon: 'mdi:open-in-new', to: path }];
		if (customer.email)
			primary.push({
				label: 'Copy Email',
				icon: 'mdi:email-outline',
				onSelect: () => copy(customer.email, 'Email')
			});
		primary.push({
			label: 'Copy Link',
			icon: 'mdi:link-variant',
			onSelect: () => copy(`${origin()}${path}`, 'Link')
		});

		const manage: Section = [];
		if (allow(Permission.ChangeCustomerTags) && opts?.onEditTags)
			manage.push({
				label: 'Edit Tags',
				icon: 'mdi:tag-multiple-outline',
				onSelect: () => opts.onEditTags?.()
			});
		if (allow(Permission.ManageCustomers)) {
			const store = useCustomerStore();
			manage.push({
				label: 'Copy Portal Access Link',
				icon: 'mdi:link-lock',
				onSelect: async () => {
					try {
						const url = await store.customerMagicLink(customer.id);
						await copy(url, 'Access Link');
					} catch (error) {
						toast.add({
							title: 'Could Not Create Link',
							description: extractServerMessage(error, 'Failed to generate an access link.'),
							icon: 'mdi:alert-circle',
							color: 'error',
							duration: 4000
						});
					}
				}
			});
		}
		return manage.length ? [primary, manage] : [primary];
	};

	const userMenu = (user: User): ContextMenuItem[][] => {
		const path = `/dashboard/users/${user.id}`;
		return [
			[
				{ label: 'Open', icon: 'mdi:open-in-new', to: path },
				{
					label: 'Copy Link',
					icon: 'mdi:link-variant',
					onSelect: () => copy(`${origin()}${path}`, 'Link')
				}
			]
		];
	};

	const labelMenu = (
		label: Label,
		opts?: { onEdit?: () => void; onDelete?: () => void }
	): ContextMenuItem[][] => {
		const primary: Section = [
			{ label: 'Copy Name', icon: 'mdi:content-copy', onSelect: () => copy(label.name, 'Name') }
		];
		const manage: Section = [];
		if (allow(Permission.ManageLabels) && opts?.onEdit)
			manage.push({ label: 'Edit', icon: 'mdi:pencil', onSelect: () => opts.onEdit?.() });
		if (allow(Permission.ManageLabels) && opts?.onDelete)
			manage.push({
				label: 'Delete',
				icon: 'mdi:delete',
				color: 'error',
				onSelect: () => opts.onDelete?.()
			});
		return manage.length ? [primary, manage] : [primary];
	};

	const projectMenu = (project: { id: number; name: string }): ContextMenuItem[][] => {
		const path = `/dashboard/projects/${project.id}`;
		return [
			[
				{ label: 'Open', icon: 'mdi:open-in-new', to: path },
				{
					label: 'Copy Link',
					icon: 'mdi:link-variant',
					onSelect: () => copy(`${origin()}${path}`, 'Link')
				}
			]
		];
	};

	// customer-side portal ticket (has a per-ticket status token)
	const portalTicketMenu = (ticket: { id: number; token: string }): ContextMenuItem[][] => {
		const path = `/status/${ticket.token}?id=${ticket.id}`;
		return [
			[
				{ label: 'Open', icon: 'mdi:open-in-new', to: path },
				{
					label: 'Copy Tracking Link',
					icon: 'mdi:link-variant',
					onSelect: () => copy(`${origin()}${path}`, 'Link')
				}
			]
		];
	};

	// project a palette command into a menu item (kbds/to/onSelect carry over)
	const toMenuItem = (item: CommandItem): ContextMenuItem => ({
		label: item.label,
		icon: item.icon,
		kbds: item.kbds,
		to: item.to,
		onSelect: item.onSelect
	});

	// the global page menu; `extra` sections (page-specific) sit on top of the role-aware command
	// registry so right-clicking any background gives navigate + actions + page utilities
	const genericMenu = (extra: ContextMenuItem[][] = []): ContextMenuItem[][] => {
		const sections: ContextMenuItem[][] = [];
		for (const section of extra) if (section.length) sections.push(section);

		const groups = commands.groups.value;
		const nav = groups.find((group) => group.id === 'navigate');

		const util: Section = [
			{
				label: 'Command Palette',
				icon: 'mdi:magnify',
				kbds: ['meta', 'k'],
				onSelect: () => palette.show()
			}
		];
		if (nav?.items.length)
			util.push({
				label: 'Go to',
				icon: 'mdi:navigation-variant-outline',
				children: nav.items.map(toMenuItem)
			});
		sections.push(util);

		// remaining command groups (actions / portal / guest) become flat sections
		for (const group of groups) {
			if (group.id === 'navigate') continue;
			const items = group.items.map(toMenuItem);
			if (items.length) sections.push(items);
		}

		sections.push([
			{
				label: 'Copy Page Link',
				icon: 'mdi:link-variant',
				onSelect: () => copy(`${origin()}${route.fullPath}`, 'Link')
			},
			{
				label: 'Reload Page',
				icon: 'mdi:refresh',
				onSelect: () => {
					if (import.meta.client) window.location.reload();
				}
			}
		]);
		return sections;
	};

	// dashboard widget / card: its own open/copy/refresh, then the full app menu underneath
	const widgetMenu = (opts: { to?: string; onRefresh?: () => void }): ContextMenuItem[][] => {
		const primary: Section = [];
		if (opts.to) {
			primary.push({ label: 'Open', icon: 'mdi:open-in-new', to: opts.to });
			primary.push({
				label: 'Copy Link',
				icon: 'mdi:link-variant',
				onSelect: () => copy(`${origin()}${opts.to}`, 'Link')
			});
		}
		if (opts.onRefresh)
			primary.push({ label: 'Refresh', icon: 'mdi:refresh', onSelect: () => opts.onRefresh?.() });
		return primary.length ? genericMenu([primary]) : genericMenu();
	};

	// audit row (fed to a per-row kebab or the table's onContextmenu): open target + copy + filter-by
	const auditMenu = (
		entry: AuditEntry,
		opts?: {
			onFilterAction?: (entry: AuditEntry) => void;
			onFilterActor?: (entry: AuditEntry) => void;
			onFilterTicket?: (entry: AuditEntry) => void;
		}
	): ContextMenuItem[][] => {
		const primary: Section = [];
		if (entry.ticket_id != null)
			primary.push({
				label: `Open Ticket #${entry.ticket_id}`,
				icon: 'mdi:open-in-new',
				to: `/dashboard/tickets/${entry.ticket_id}`
			});
		if (entry.summary)
			primary.push({
				label: 'Copy Summary',
				icon: 'mdi:content-copy',
				onSelect: () => copy(entry.summary as string, 'Summary')
			});
		primary.push({
			label: 'Copy Details',
			icon: 'mdi:code-json',
			onSelect: () => copy(JSON.stringify(entry, null, 2), 'Details')
		});

		const filters: Section = [];
		if (opts?.onFilterAction)
			filters.push({
				label: `Filter by ${prettyAction(entry.action)}`,
				icon: 'mdi:filter-variant',
				onSelect: () => opts.onFilterAction?.(entry)
			});
		if (opts?.onFilterActor && (entry.actor_name || entry.actor_id))
			filters.push({
				label: `Filter by ${entry.actor_name || entry.actor_id}`,
				icon: 'mdi:account-filter-outline',
				onSelect: () => opts.onFilterActor?.(entry)
			});
		if (opts?.onFilterTicket && entry.ticket_id != null)
			filters.push({
				label: `Filter by Ticket #${entry.ticket_id}`,
				icon: 'mdi:ticket-outline',
				onSelect: () => opts.onFilterTicket?.(entry)
			});

		return filters.length ? [primary, filters] : [primary];
	};

	return {
		ticketMenu,
		customerMenu,
		userMenu,
		labelMenu,
		projectMenu,
		portalTicketMenu,
		genericMenu,
		widgetMenu,
		auditMenu
	};
}

// #endregion
