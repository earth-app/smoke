import type { ContextMenuItem } from '@nuxt/ui';

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
