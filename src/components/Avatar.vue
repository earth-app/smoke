<template>
	<UAvatar
		:icon="resolvedIcon"
		:src="resolvedSrc"
		:alt="label"
		:size="size as any"
		:color="resolvedColor as any"
	/>
</template>

<script setup lang="ts">
import type { Role } from '~/shared/types/user';

const props = defineProps<{
	avatar?: string | null;
	id?: string | number | null;
	icon?: string | null;
	name?: string;
	role?: Role;
	color?: string | null;
	size?: string;
	alt?: string;
}>();

const { settings } = useSettings();

const label = computed(() => props.alt || props.name || undefined);

const roleColors = computed(() => (settings.value?.role_colors || {}) as Record<string, string>);
const roleIcons = computed(() => (settings.value?.role_icons || {}) as Record<string, string>);

// true when the avatar resolves to an image (uploaded blob or external url), not an icon
const hasImage = computed(() => {
	const avatar = props.avatar;
	if (!avatar) return false;
	if (avatar.startsWith('icon:')) return false;
	if (avatar === 'local') return props.id != null;
	return /^https?:\/\//i.test(avatar);
});

// explicit icon prop wins, then the `icon:` sentinel, then the role default when there's no image
const resolvedIcon = computed(() => {
	if (props.icon) return props.icon;
	if (props.avatar?.startsWith('icon:')) return props.avatar.slice('icon:'.length);
	if (!hasImage.value && props.role) return roleIcons.value[props.role] || undefined;
	return undefined;
});

const resolvedSrc = computed(() => {
	if (resolvedIcon.value) return undefined;
	const avatar = props.avatar;
	if (!avatar) return undefined;
	// "local" is an uploaded blob served by the avatar endpoint (users only)
	if (avatar === 'local') return props.id != null ? `/api/users/${props.id}/avatar` : undefined;
	if (/^https?:\/\//i.test(avatar)) return avatar;
	return undefined;
});

// nuxt ui color tints an icon/text avatar only (never an image); explicit color wins over role default
const resolvedColor = computed(() => {
	if (hasImage.value) return undefined;
	if (props.color) return props.color;
	if (props.role) return roleColors.value[props.role] || undefined;
	return undefined;
});
</script>
