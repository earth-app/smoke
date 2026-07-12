<template>
	<div
		class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
	>
		<div>
			<h3 class="text-sm font-semibold">Default Ticket Visibility</h3>
			<p class="text-xs text-slate-500">
				Choose how new tickets start out based on how they were opened. Public tickets appear in the
				public search; private and internal tickets do not.
			</p>
		</div>

		<UFormField
			v-for="source in sources"
			:key="source.key"
			:label="source.label"
			:help="source.help"
		>
			<USelect
				v-model="form[source.key]"
				:items="visibilityItems"
				class="w-full sm:w-72"
			>
				<template #leading="{ modelValue }">
					<UIcon
						v-if="modelValue"
						:name="VISIBILITY_DISPLAY[modelValue as TicketVisibility].icon"
					/>
				</template>
			</USelect>
		</UFormField>

		<div class="flex justify-end">
			<UButton
				color="primary"
				icon="mdi:content-save-outline"
				:loading="saving"
				@click="onSave"
			>
				Save Visibility
			</UButton>
		</div>
	</div>
</template>

<script setup lang="ts">
import { TicketVisibility } from '~/shared/types/ticket';

const toast = useToast();
const { settings, save } = useSettings();

type Vis = 'public' | 'internal' | 'private';
type SourceKey = 'guest' | 'emailed' | 'team';

const form = reactive<Record<SourceKey, Vis>>({
	guest: 'private',
	emailed: 'private',
	team: 'private'
});

const sources: { key: SourceKey; label: string; help: string }[] = [
	{
		key: 'guest',
		label: 'Guest Submissions',
		help: 'Tickets opened from the public request form.'
	},
	{ key: 'emailed', label: 'Emailed by a Customer', help: 'Tickets opened by inbound email.' },
	{ key: 'team', label: 'Created by a Team Member', help: 'Tickets opened in the dashboard.' }
];

// icon + description pulled from the shared visibility display map
const visibilityItems = visibilitySelectItems().map((item) => ({
	...item,
	description: VISIBILITY_DISPLAY[item.value as TicketVisibility].description
}));

const saving = ref(false);

watch(
	settings,
	(value) => {
		const v = (value?.visibility as Partial<Record<SourceKey, Vis>>) || {};
		form.guest = v.guest ?? 'private';
		form.emailed = v.emailed ?? 'private';
		form.team = v.team ?? 'private';
	},
	{ immediate: true }
);

async function onSave() {
	saving.value = true;
	try {
		await save({ visibility: { ...form } });
		toast.add({
			title: 'Visibility Saved',
			description: 'Default ticket visibility was updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Save Visibility',
			description: extractServerMessage(error, 'Could not save visibility defaults.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
