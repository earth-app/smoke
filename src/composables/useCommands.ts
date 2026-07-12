import type { ContextMenuItem } from '@nuxt/ui';

// a combo -> handler map; assignable to defineShortcuts' config shape
type ShortcutsConfig = Record<string, () => void>;

// one entry serves the palette (group items), the nav chords (shortcut), and its kbd hint (derived
// from shortcut so there is a single source of truth); color carries into the context menu variant
export interface CommandItem {
	id: string;
	label: string;
	icon?: string;
	kbds?: string[];
	shortcut?: string;
	to?: string;
	onSelect?: () => void;
	suffix?: string;
	color?: ContextMenuItem['color'];
}

export interface CommandGroup {
	id: string;
	label: string;
	items: CommandItem[];
}

export type RoleContext = 'owner' | 'admin' | 'manager' | 'agent' | 'customer' | 'guest';

// derive the kbd display hint from the shortcut combo ('g-t' -> ['g','t'], 'n' -> ['n'])
function toKbds(shortcut?: string): string[] | undefined {
	if (!shortcut) return undefined;
	return shortcut.split('-');
}

function withKbds(item: CommandItem): CommandItem {
	return { ...item, kbds: item.kbds ?? toKbds(item.shortcut) };
}

// the role-aware command + shortcut registry; the single source both the palette and the global
// shortcuts read from. gating is by omission, reusing the app-wide `isAdmin || can(perm)` idiom
export function useCommands() {
	const auth = useAuth();
	const customerAuth = useCustomerAuth();
	const colorMode = useColorMode();

	const allow = (permission: Permission) => auth.isAdmin.value || auth.can(permission);

	const roleContext = computed<RoleContext>(() => {
		if (auth.isAuthenticated.value) {
			if (auth.isOwner.value) return 'owner';
			if (auth.isAdmin.value) return 'admin';
			if (auth.user.value?.role === Role.Manager) return 'manager';
			return 'agent';
		}
		if (customerAuth.isCustomer.value) return 'customer';
		return 'guest';
	});

	const roleLabel = computed(() => {
		return {
			owner: 'Owner',
			admin: 'Admin',
			manager: 'Manager',
			agent: 'Agent',
			customer: 'Customer',
			guest: 'Guest'
		}[roleContext.value];
	});

	const roleIcon = computed(() => {
		return {
			owner: 'mdi:crown',
			admin: 'mdi:shield-crown',
			manager: 'mdi:shield-account',
			agent: 'mdi:account-tie',
			customer: 'mdi:account',
			guest: 'mdi:account-outline'
		}[roleContext.value];
	});

	const toggleTheme = () => {
		colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark';
	};

	const themeItem = computed<CommandItem>(() => ({
		id: 'theme',
		label: colorMode.value === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
		icon: colorMode.value === 'dark' ? 'mdi:white-balance-sunny' : 'mdi:weather-night',
		color: 'secondary',
		onSelect: toggleTheme
	}));

	// staff navigation (each a `g-<key>` chord)
	const navItems = computed<CommandItem[]>(() => {
		const items: CommandItem[] = [
			{
				id: 'nav-overview',
				label: 'Overview',
				icon: 'mdi:view-dashboard-outline',
				to: '/dashboard',
				shortcut: 'g-o'
			},
			{
				id: 'nav-tickets',
				label: 'Tickets',
				icon: 'mdi:ticket-outline',
				to: '/dashboard/tickets',
				shortcut: 'g-t'
			},
			{
				id: 'nav-projects',
				label: 'Projects',
				icon: 'mdi:folder-multiple-outline',
				to: '/dashboard/projects',
				shortcut: 'g-p'
			},
			{
				id: 'nav-customers',
				label: 'Customers',
				icon: 'mdi:account-group-outline',
				to: '/dashboard/customers',
				shortcut: 'g-c'
			}
		];
		if (allow(Permission.ChangeLabels))
			items.push({
				id: 'nav-labels',
				label: 'Labels',
				icon: 'mdi:tag-multiple-outline',
				to: '/dashboard/labels',
				shortcut: 'g-l'
			});
		if (allow(Permission.ManageUsers))
			items.push({
				id: 'nav-users',
				label: 'Users',
				icon: 'mdi:account-multiple-outline',
				to: '/dashboard/users',
				shortcut: 'g-u'
			});
		if (allow(Permission.ViewAuditLog))
			items.push({
				id: 'nav-audit',
				label: 'Audit Log',
				icon: 'mdi:history',
				to: '/dashboard/audit',
				shortcut: 'g-a'
			});
		if (allow(Permission.ManageSettings))
			items.push({
				id: 'nav-settings',
				label: 'Settings',
				icon: 'mdi:cog-outline',
				to: '/dashboard/settings',
				shortcut: 'g-s'
			});
		items.push({
			id: 'nav-profile',
			label: 'Profile',
			icon: 'mdi:account-circle-outline',
			to: '/dashboard/profile',
			shortcut: 'g-m'
		});
		return items.map(withKbds);
	});

	// staff actions (create flows open the page's modal via ?new=1; theme + sign out)
	const staffActionItems = computed<CommandItem[]>(() => {
		const items: CommandItem[] = [];
		if (allow(Permission.CreateTicket))
			items.push({
				id: 'new-ticket',
				label: 'New Ticket',
				icon: 'mdi:plus-circle-outline',
				color: 'primary',
				to: '/dashboard/tickets?new=1',
				shortcut: 'n'
			});
		if (allow(Permission.ManageCustomers))
			items.push({
				id: 'new-customer',
				label: 'New Customer',
				icon: 'mdi:account-plus-outline',
				color: 'primary',
				to: '/dashboard/customers?new=1'
			});
		if (allow(Permission.ManageLabels))
			items.push({
				id: 'new-label',
				label: 'New Label',
				icon: 'mdi:tag-plus-outline',
				color: 'primary',
				to: '/dashboard/labels'
			});
		items.push(withKbds(themeItem.value));
		items.push({
			id: 'signout',
			label: 'Sign Out',
			icon: 'mdi:logout',
			color: 'error',
			onSelect: async () => {
				await auth.logout();
				await navigateTo('/login');
			}
		});
		return items.map(withKbds);
	});

	// customer portal
	const portalItems = computed<CommandItem[]>(() => [
		{
			id: 'portal-requests',
			label: 'My Requests',
			icon: 'mdi:inbox-outline',
			color: 'primary',
			to: '/portal'
		},
		withKbds(themeItem.value),
		{
			id: 'portal-signout',
			label: 'Sign Out',
			icon: 'mdi:logout',
			color: 'error',
			onSelect: async () => {
				await customerAuth.logout();
				await navigateTo('/portal/login');
			}
		}
	]);

	// anonymous visitor
	const guestItems = computed<CommandItem[]>(() => [
		{
			id: 'guest-submit',
			label: 'Submit a Request',
			icon: 'mdi:email-plus-outline',
			color: 'primary',
			to: '/submit'
		},
		{
			id: 'guest-track',
			label: 'Track a Request',
			icon: 'mdi:magnify',
			color: 'info',
			to: '/search'
		},
		{
			id: 'guest-portal',
			label: 'Customer Portal',
			icon: 'mdi:account-circle-outline',
			to: '/portal/login'
		},
		{ id: 'guest-login', label: 'Staff Login', icon: 'mdi:login', to: '/login' },
		withKbds(themeItem.value)
	]);

	// groups shaped for UCommandPalette, chosen by the current identity
	const groups = computed<CommandGroup[]>(() => {
		if (auth.isAuthenticated.value) {
			return [
				{ id: 'navigate', label: 'Navigate', items: navItems.value },
				{ id: 'actions', label: 'Actions', items: staffActionItems.value }
			];
		}
		if (customerAuth.isCustomer.value) {
			return [{ id: 'portal', label: 'Your Portal', items: portalItems.value }];
		}
		return [{ id: 'guest', label: 'Get Started', items: guestItems.value }];
	});

	// defineShortcuts config derived from the visible items that declare a shortcut (single source);
	// the palette component merges in the open/close combos (meta_k etc.)
	const shortcuts = computed<ShortcutsConfig>(() => {
		const config: ShortcutsConfig = {};
		const source = auth.isAuthenticated.value ? [...navItems.value, ...staffActionItems.value] : [];
		for (const item of source) {
			if (!item.shortcut) continue;
			config[item.shortcut] = () => {
				if (item.onSelect) item.onSelect();
				else if (item.to) navigateTo(item.to);
			};
		}
		return config;
	});

	return { roleContext, roleLabel, roleIcon, groups, shortcuts, toggleTheme };
}

export function useCommandPalette() {
	const open = useState('smoke:cmdk:open', () => false);
	return {
		open,
		toggle: () => (open.value = !open.value),
		show: () => (open.value = true),
		hide: () => (open.value = false)
	};
}
