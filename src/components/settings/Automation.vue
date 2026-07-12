<template>
	<div class="flex flex-col gap-4">
		<div
			class="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
		>
			<UIcon
				name="mdi:robot-outline"
				class="size-6 text-primary-500"
			/>
			<div class="flex-1">
				<h3 class="text-sm font-semibold">Automation Identity</h3>
				<p class="text-xs text-slate-500">
					Choose how messages posted by automation flows appear in the ticket thread.
				</p>
			</div>
		</div>

		<div
			class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
		>
			<UFormField
				label="Post Messages as"
				help="Team posts anonymously; Automation uses a named bot identity with the robot icon."
			>
				<USelect
					v-model="form.identity"
					:items="identityItems"
					class="w-full sm:w-64"
				>
					<template #leading="{ modelValue }">
						<UIcon
							v-if="modelValue"
							:name="identityIcons[modelValue as 'team' | 'automation']"
						/>
					</template>
				</USelect>
			</UFormField>

			<UFormField
				v-if="form.identity === 'automation'"
				label="Automation Name"
				help="Display name shown next to automated messages."
			>
				<UInput
					v-model="form.name"
					placeholder="Automation"
					class="w-full sm:w-64"
				/>
			</UFormField>

			<div class="flex justify-end">
				<UButton
					color="primary"
					icon="mdi:content-save-outline"
					:loading="saving"
					@click="onSave"
					>Save Automation</UButton
				>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
const toast = useToast();
const { settings, save } = useSettings();

const form = reactive<{ identity: 'team' | 'automation'; name: string }>({
	identity: 'team',
	name: 'Automation'
});
const saving = ref(false);

const identityIcons: Record<'team' | 'automation', string> = {
	team: 'mdi:account-group-outline',
	automation: 'mdi:robot-outline'
};

const identityItems = [
	{ label: 'Team', value: 'team', icon: identityIcons.team },
	{ label: 'Automation', value: 'automation', icon: identityIcons.automation }
];

// seed from the loaded settings once they arrive
watchEffect(() => {
	const automation = settings.value?.automation;
	if (!automation) return;
	form.identity = automation.identity === 'automation' ? 'automation' : 'team';
	form.name = automation.name || 'Automation';
});

async function onSave() {
	saving.value = true;
	try {
		await save({
			automation: { identity: form.identity, name: form.name.trim() || 'Automation' }
		});
		toast.add({
			title: 'Automation Saved',
			description: 'Automation identity updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Save Automation',
			description: extractServerMessage(error, 'Could not save automation settings.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
