<template>
	<UContextMenu :items="items">
		<div :class="wrapperClass">
			<slot />
		</div>
	</UContextMenu>
</template>

<script setup lang="ts">
const props = defineProps<{ wrapperClass?: string }>();

const { genericMenu } = useEntityMenus();
const pageMenu = usePageMenu();

const items = computed(() => genericMenu(pageMenu.value));

const wrapperClass = computed(() => props.wrapperClass ?? 'block min-h-full w-full');
</script>
