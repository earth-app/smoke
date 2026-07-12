import { TicketPriority, TicketStatus, TicketVisibility } from '~/shared/types/ticket';

// shared icon + color + description metadata for the enum-backed dropdowns across the app.
// color is a nuxt ui theme token; icon is an iconify name. keeps status/priority/visibility
// menus consistent (a colored leading icon + a short description under the label)

// nuxt ui semantic color tokens (matches UBadge/UChip/USelect item chip `color`)
export type UiColor =
	'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral';

export type DisplayMeta = { label: string; icon: string; color: UiColor; description?: string };

export const STATUS_DISPLAY: Record<TicketStatus, DisplayMeta> = {
	[TicketStatus.Submitted]: {
		label: 'Submitted',
		icon: 'mdi:tray-arrow-down',
		color: 'primary',
		description: 'Newly received, not yet triaged'
	},
	[TicketStatus.Open]: {
		label: 'Open',
		icon: 'mdi:folder-open-outline',
		color: 'info',
		description: 'Being worked or awaiting action'
	},
	[TicketStatus.Pending]: {
		label: 'Pending',
		icon: 'mdi:clock-outline',
		color: 'warning',
		description: 'Waiting on the customer or a third party'
	},
	[TicketStatus.WorkInProgress]: {
		label: 'Work in Progress',
		icon: 'mdi:progress-wrench',
		color: 'info',
		description: 'Actively in progress'
	},
	[TicketStatus.Closed]: {
		label: 'Closed',
		icon: 'mdi:check-circle-outline',
		color: 'neutral',
		description: 'Resolved and closed'
	},
	[TicketStatus.WontFix]: {
		label: "Won't Fix",
		icon: 'mdi:cancel',
		color: 'neutral',
		description: 'Closed without a fix'
	}
};

export const PRIORITY_DISPLAY: Record<TicketPriority, DisplayMeta> = {
	[TicketPriority.None]: { label: 'None', icon: 'mdi:minus', color: 'neutral' },
	[TicketPriority.Low]: { label: 'Low', icon: 'mdi:chevron-up', color: 'info' },
	[TicketPriority.Medium]: { label: 'Medium', icon: 'mdi:equal', color: 'primary' },
	[TicketPriority.High]: { label: 'High', icon: 'mdi:chevron-double-up', color: 'warning' },
	[TicketPriority.Critical]: { label: 'Critical', icon: 'mdi:alert', color: 'error' }
};

export const VISIBILITY_DISPLAY: Record<TicketVisibility, DisplayMeta> = {
	[TicketVisibility.Public]: {
		label: 'Public (Searchable)',
		icon: 'mdi:earth',
		color: 'success',
		description: 'Listed publicly + viewable via a status link'
	},
	[TicketVisibility.Internal]: {
		label: 'Internal (Staff Only)',
		icon: 'mdi:shield-account-outline',
		color: 'warning',
		description: 'Visible to signed-in staff only'
	},
	[TicketVisibility.Private]: {
		label: 'Private (Unlisted)',
		icon: 'mdi:lock-outline',
		color: 'neutral',
		description: 'Submitter + assignees + permitted staff'
	}
};

// rich USelect/USelectMenu item lists: a leading icon, a colored chip dot, and a description
function toItem(value: string, meta: DisplayMeta) {
	return {
		value,
		label: meta.label,
		icon: meta.icon,
		chip: { color: meta.color },
		...(meta.description ? { description: meta.description } : {})
	};
}

export function statusSelectItems() {
	return (Object.values(TicketStatus) as TicketStatus[]).map((v) => toItem(v, STATUS_DISPLAY[v]));
}

export function prioritySelectItems() {
	return (Object.values(TicketPriority) as TicketPriority[]).map((v) =>
		toItem(v, PRIORITY_DISPLAY[v])
	);
}

export function visibilitySelectItems() {
	return (Object.values(TicketVisibility) as TicketVisibility[]).map((v) =>
		toItem(v, VISIBILITY_DISPLAY[v])
	);
}
