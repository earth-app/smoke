<template>
	<footer
		class="border-t border-slate-200 bg-white px-4 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 sm:px-6"
	>
		<div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
			<div class="flex flex-col items-center gap-0.5 sm:items-start">
				<span>&copy; {{ year }} {{ brandName }}. All rights reserved.</span>
				<span class="text-xs">Powered by {{ projectName }}</span>
			</div>
			<div class="flex items-center gap-4">
				<NuxtLink
					v-for="link in socialLinks"
					:key="link.key"
					:to="link.href"
					:aria-label="link.label"
					class="hover:text-primary-500"
					target="_blank"
					rel="noopener noreferrer"
				>
					<UIcon
						:name="link.icon"
						class="size-5"
					/>
				</NuxtLink>
				<NuxtLink
					to="/dashboard"
					class="hover:text-primary-500"
					>Dashboard</NuxtLink
				>
			</div>
		</div>
	</footer>
</template>

<script setup lang="ts">
const { settings } = useSettings();

const year = new Date().getFullYear();
const brandName = computed(() => (settings.value?.name as string) || 'Smoke');
const projectName = PROJECT_NAME;

// normalize a stored handle/url into an absolute href for a given network
function socialHref(key: string, raw: string): string {
	const v = raw.trim();
	if (!v) return '';
	if (/^https?:\/\//i.test(v)) return v;
	const handle = v.replace(/^@/, '');
	switch (key) {
		case 'website':
			return `https://${v.replace(/^https?:\/\//, '')}`;
		case 'github':
			return `https://github.com/${handle}`;
		case 'twitter':
			return `https://x.com/${handle}`;
		case 'instagram':
			return `https://instagram.com/${handle}`;
		case 'linkedin':
			return `https://linkedin.com/${handle.includes('/') ? handle : `in/${handle}`}`;
		case 'patreon':
			return `https://patreon.com/${handle}`;
		case 'discord':
			return v;
		default:
			return v;
	}
}

const SOCIALS: { key: string; label: string; icon: string }[] = [
	{ key: 'website', label: 'Website', icon: 'mdi:web' },
	{ key: 'github', label: 'GitHub', icon: 'mdi:github' },
	{ key: 'twitter', label: 'Twitter', icon: 'mdi:twitter' },
	{ key: 'instagram', label: 'Instagram', icon: 'mdi:instagram' },
	{ key: 'discord', label: 'Discord', icon: 'mdi:discord' },
	{ key: 'linkedin', label: 'LinkedIn', icon: 'mdi:linkedin' },
	{ key: 'patreon', label: 'Patreon', icon: 'mdi:patreon' }
];

const socialLinks = computed(() =>
	SOCIALS.map((s) => ({
		...s,
		href: socialHref(s.key, (settings.value?.[s.key] as string) || '')
	})).filter((s) => s.href)
);
</script>
