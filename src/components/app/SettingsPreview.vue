<template>
	<UCard>
		<template #header>
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-semibold">Settings</h2>
				<UButton
					to="/dashboard/settings"
					variant="link"
					color="primary"
					size="xs"
					trailing-icon="mdi:arrow-right"
					>Manage</UButton
				>
			</div>
		</template>

		<div
			v-if="loading"
			class="space-y-3"
		>
			<Skeleton
				variant="line"
				width="10rem"
				height="1rem"
			/>
			<Skeleton
				variant="text"
				:repeat="2"
			/>
			<div class="flex items-center gap-2 pt-1">
				<Skeleton
					variant="avatar"
					width="1.25rem"
					height="1.25rem"
				/>
				<Skeleton
					variant="line"
					width="12rem"
					height="0.875rem"
				/>
			</div>
		</div>

		<dl
			v-else
			class="space-y-3 text-sm"
		>
			<div class="flex items-center justify-between gap-3">
				<dt class="text-slate-500">Brand</dt>
				<dd class="truncate font-medium">{{ brandName }}</dd>
			</div>
			<div class="flex items-start justify-between gap-3">
				<dt class="shrink-0 text-slate-500">Description</dt>
				<dd class="truncate text-right text-muted">{{ description }}</dd>
			</div>
			<div class="flex items-center justify-between gap-3">
				<dt class="text-slate-500">Support Email</dt>
				<dd class="truncate font-medium">{{ supportEmail || 'Not Set' }}</dd>
			</div>
			<div class="flex items-center justify-between gap-3">
				<dt class="text-slate-500">Theme</dt>
				<dd class="flex items-center gap-2">
					<span
						class="size-4 rounded-full ring-1 ring-slate-200 dark:ring-slate-700"
						:style="{ backgroundColor: themeColor }"
					/>
					<span class="font-mono text-xs uppercase">{{ themeColor }}</span>
				</dd>
			</div>
		</dl>
	</UCard>
</template>

<script setup lang="ts">
const { settings } = useSettings();

const loading = computed(() => settings.value === null);

const brandName = computed(() => (settings.value?.name as string) || 'Smoke');
const description = computed(
	() => (settings.value?.description as string) || 'No description set.'
);
const themeColor = computed(() => (settings.value?.themeColor as string) || '#3b82f6');
const supportEmail = computed(
	() => (settings.value?.support_email as string) || (settings.value?.supportEmail as string) || ''
);
</script>
