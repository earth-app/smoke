import type { Label } from '~/shared/types/user';
import { isNuxtColor } from '~/shared/utils/colors';

// github-style default palette for new/edited labels
export const LABEL_COLOR_PALETTE = [
	'#ef4444',
	'#f97316',
	'#f59e0b',
	'#eab308',
	'#84cc16',
	'#22c55e',
	'#10b981',
	'#14b8a6',
	'#06b6d4',
	'#3b82f6',
	'#6366f1',
	'#8b5cf6',
	'#a855f7',
	'#ec4899',
	'#64748b'
] as const;

// fallback tint when a label has no color
export const DEFAULT_LABEL_COLOR = '#94a3b8';

// find an existing label by name (case-insensitive, trimmed)
export function findLabelByName(labels: Label[], name: string): Label | undefined {
	const needle = name.trim().toLowerCase();
	if (!needle) return undefined;
	return labels.find((l) => l.name.trim().toLowerCase() === needle);
}

// offer a create affordance only when the term is new and the user may manage labels
export function shouldOfferCreate(labels: Label[], term: string, canManage: boolean): boolean {
	if (!canManage) return false;
	if (!term.trim()) return false;
	return !findLabelByName(labels, term);
}

// add an id once, preserving order
export function withLabelId(ids: number[], id: number): number[] {
	return ids.includes(id) ? ids : [...ids, id];
}

// drop an id
export function withoutLabelId(ids: number[], id: number): number[] {
	return ids.filter((x) => x !== id);
}

// pick a random palette color for a new label
export function randomLabelColor(): string {
	return LABEL_COLOR_PALETTE[Math.floor(Math.random() * LABEL_COLOR_PALETTE.length)]!;
}

// validate a hex color (#rgb or #rrggbb)
export function isHexColor(value: string): boolean {
	return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

// a label color is valid when it is a nuxt theme token or a css hex
export function isValidLabelColor(value: string): boolean {
	return isNuxtColor(value) || isHexColor(value);
}
