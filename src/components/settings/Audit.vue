<template>
	<div class="flex flex-col gap-6">
		<section
			class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
		>
			<div>
				<h3 class="text-sm font-semibold">Audit Log Retention</h3>
				<p class="text-xs text-slate-500">
					A daily job removes audit entries older than this window. Leave blank to keep every entry
					forever.
				</p>
			</div>

			<UFormField
				label="Keep Entries For (Days)"
				help="Audit entries older than this many days are permanently deleted. Leave blank to never delete."
			>
				<UInput
					:model-value="displayValue(form.retention_days)"
					type="number"
					min="1"
					placeholder="Forever"
					class="w-full sm:w-48"
					@update:model-value="(v: string | number) => (form.retention_days = toDays(v))"
				/>
			</UFormField>

			<UAlert
				v-if="form.retention_days != null && form.retention_days > 0"
				color="warning"
				variant="subtle"
				icon="mdi:information-outline"
				title="Automatic Pruning is Enabled"
				:description="`Audit entries older than ${form.retention_days} days are deleted for good. Export anything you need to keep before it ages out.`"
			/>
		</section>

		<div class="flex justify-end">
			<UButton
				color="primary"
				icon="mdi:content-save-outline"
				:loading="saving"
				@click="onSave"
			>
				Save Audit Settings
			</UButton>
		</div>
	</div>
</template>

<script setup lang="ts">
const toast = useToast();
const { settings, save } = useSettings();

const form = reactive<{ retention_days: number | null }>({ retention_days: null });

const saving = ref(false);

// empty (or a non-finite entry) means "forever"; anything else is the raw day count
function toDays(value: string | number): number | null {
	if (value === '' || value == null) return null;
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function displayValue(value: number | null): string {
	return value == null ? '' : String(value);
}

watch(
	settings,
	(value) => {
		const audit = (value?.audit as Record<string, unknown>) || {};
		form.retention_days = typeof audit.retention_days === 'number' ? audit.retention_days : null;
	},
	{ immediate: true }
);

async function onSave() {
	saving.value = true;
	try {
		await save({ audit: { retention_days: form.retention_days } });
		toast.add({
			title: 'Audit Settings Saved',
			description: 'Your audit retention settings were updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Save Audit Settings',
			description: extractServerMessage(error, 'Could not save audit settings.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
