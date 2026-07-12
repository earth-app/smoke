<template>
	<UButton
		icon="mdi:magnify"
		color="neutral"
		variant="subtle"
		:square="collapsed"
		:block="block"
		:class="block && !collapsed ? 'justify-start' : undefined"
		title="Search (Cmd K)"
		aria-label="Open Command Palette"
		@click="openPalette"
	>
		<span
			v-if="!collapsed"
			class="hidden text-muted sm:inline"
			>Search...</span
		>
		<template
			v-if="!collapsed"
			#trailing
		>
			<div class="ml-auto hidden items-center gap-0.5 sm:flex">
				<UKbd value="meta" />
				<UKbd value="k" />
			</div>
		</template>
	</UButton>
</template>

<script setup lang="ts">
// collapsed = icon-only square (collapsed sidebar); block = full-width search-bar style
defineProps<{ collapsed?: boolean; block?: boolean }>();
const { show } = useCommandPalette();
const openPalette = () => {
	show();
};
</script>
