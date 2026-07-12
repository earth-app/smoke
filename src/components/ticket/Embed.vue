<template>
	<a
		:href="info.url"
		target="_blank"
		rel="noopener noreferrer nofollow"
		:title="info.title"
		:class="cardClass"
	>
		<template v-if="rich">
			<img
				v-if="showImage"
				:src="preview!.image"
				alt=""
				loading="lazy"
				referrerpolicy="no-referrer"
				class="h-16 w-16 shrink-0 object-cover"
				@error="imageError = true"
			/>
			<img
				v-else-if="showFavicon"
				:src="preview!.favicon"
				alt=""
				loading="lazy"
				referrerpolicy="no-referrer"
				class="mt-0.5 size-6 shrink-0 rounded"
				@error="faviconError = true"
			/>
			<UIcon
				v-else
				:name="icon"
				class="mt-0.5 size-6 shrink-0 text-slate-500 dark:text-slate-400"
			/>
			<span :class="['min-w-0 flex-1', showImage ? 'py-2 pr-3' : '']">
				<span class="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{{
					title
				}}</span>
				<span
					v-if="preview!.description"
					class="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400"
					>{{ preview!.description }}</span
				>
				<span class="mt-0.5 block truncate text-xs text-slate-400">{{ siteLine }}</span>
			</span>
		</template>

		<template v-else>
			<UIcon
				:name="icon"
				class="size-5 shrink-0 text-slate-500 dark:text-slate-400"
			/>
			<span class="min-w-0">
				<span class="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{{
					info.label
				}}</span>
				<span class="block truncate text-xs text-slate-400">{{ info.host }}</span>
			</span>
		</template>
	</a>
</template>

<script setup lang="ts">
const props = defineProps<{ url: string }>();

const { preview, classified: info } = useUnfurl(() => props.url);

const imageError = ref(false);
const faviconError = ref(false);

// reset image fallbacks whenever the resolved preview changes
watch(preview, () => {
	imageError.value = false;
	faviconError.value = false;
});

// most specific kind wins; provider is the fallback tier before the generic link glyph
const KIND_ICONS: Record<string, string> = {
	'google-doc': 'mdi:file-document-outline',
	'github-issue': 'mdi:alert-circle-outline',
	'github-pr': 'mdi:source-pull',
	'github-repo': 'mdi:github',
	'github-gist': 'mdi:code-braces',
	'gitlab-issue': 'mdi:alert-circle-outline',
	'gitlab-mr': 'mdi:source-pull',
	'gitlab-repo': 'mdi:gitlab',
	'bitbucket-issue': 'mdi:alert-circle-outline',
	'bitbucket-pr': 'mdi:source-pull',
	'bitbucket-repo': 'mdi:bitbucket',
	stackoverflow: 'mdi:stack-overflow',
	jira: 'mdi:jira',
	discord: 'mdi:discord',
	instagram: 'mdi:instagram',
	youtube: 'mdi:youtube',
	docker: 'mdi:docker',
	spotify: 'mdi:spotify',
	wikipedia: 'mdi:wikipedia',
	generic: 'mdi:link-variant'
};

const PROVIDER_ICONS: Record<string, string> = {
	github: 'mdi:github',
	google: 'mdi:google',
	gitlab: 'mdi:gitlab',
	bitbucket: 'mdi:bitbucket',
	stackoverflow: 'mdi:stack-overflow',
	jira: 'mdi:jira',
	discord: 'mdi:discord',
	instagram: 'mdi:instagram',
	youtube: 'mdi:youtube',
	docker: 'mdi:docker',
	spotify: 'mdi:spotify',
	wikipedia: 'mdi:wikipedia',
	generic: 'mdi:link-variant'
};

const icon = computed(
	() => KIND_ICONS[info.value.kind] ?? PROVIDER_ICONS[info.value.provider] ?? 'mdi:link-variant'
);

// rich card once the client enrichment resolved a title or image
const rich = computed(() => !!preview.value && (!!preview.value.title || !!preview.value.image));
const showImage = computed(() => rich.value && !!preview.value?.image && !imageError.value);
const showFavicon = computed(
	() => rich.value && !showImage.value && !!preview.value?.favicon && !faviconError.value
);

const title = computed(() => preview.value?.title || info.value.label);
const siteLine = computed(() => preview.value?.siteName || info.value.host);

const CARD_BASE =
	'rounded-lg border border-slate-200 bg-white text-left no-underline transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800';

const cardClass = computed(() => {
	if (!rich.value) return `${CARD_BASE} inline-flex max-w-full items-center gap-2 px-3 py-2`;
	if (showImage.value)
		return `${CARD_BASE} flex w-full max-w-md items-stretch gap-3 overflow-hidden`;
	return `${CARD_BASE} flex w-full max-w-md items-start gap-3 px-3 py-2`;
});
</script>
