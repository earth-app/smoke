<template>
	<div class="flex flex-col gap-6">
		<section
			class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
		>
			<div>
				<h3 class="text-sm font-semibold">Thread Locking</h3>
				<p class="text-xs text-slate-500">
					Control how conversations are locked and whether customers can reopen them.
				</p>
			</div>

			<div class="flex items-center justify-between gap-4">
				<div>
					<p class="text-sm font-medium">Auto-Lock on Close</p>
					<p class="text-xs text-slate-500">
						Lock a thread automatically when its status becomes Closed.
					</p>
				</div>
				<USwitch v-model="form.auto_lock_on_close" />
			</div>

			<div class="flex items-center justify-between gap-4">
				<div>
					<p class="text-sm font-medium">Allow Customers to Reopen</p>
					<p class="text-xs text-slate-500">
						Let customers reopen a closed request from the public status page.
					</p>
				</div>
				<USwitch v-model="form.customer_reopen" />
			</div>
		</section>

		<section
			class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
		>
			<div>
				<h3 class="text-sm font-semibold">Data Retention</h3>
				<p class="text-xs text-slate-500">
					A daily job archives resolved tickets and can permanently delete old archived tickets.
				</p>
			</div>

			<UFormField
				label="Archive After (Days)"
				help="Closed tickets older than this are archived. Leave blank or 0 to never archive."
			>
				<UInput
					:model-value="displayValue(form.archive_days)"
					type="number"
					min="0"
					placeholder="90"
					class="w-full sm:w-48"
					@update:model-value="(v: string | number) => (form.archive_days = toDays(v))"
				/>
			</UFormField>

			<UFormField
				label="Delete After (Days)"
				help="Archived tickets older than this are permanently deleted. Leave blank to never delete."
			>
				<UInput
					:model-value="displayValue(form.delete_days)"
					type="number"
					min="1"
					placeholder="Never"
					class="w-full sm:w-48"
					@update:model-value="(v: string | number) => (form.delete_days = toDays(v))"
				/>
			</UFormField>

			<UAlert
				v-if="form.delete_days != null && form.delete_days > 0"
				color="error"
				variant="subtle"
				icon="mdi:alert-outline"
				title="Permanent Deletion is Enabled"
				description="Archived tickets past this window are deleted for good, with no way to recover them. We recommend leaving deletion off unless you have a policy that requires it."
			/>
		</section>

		<div class="flex justify-end">
			<UButton
				color="primary"
				icon="mdi:content-save-outline"
				:loading="saving"
				@click="onSave"
			>
				Save Retention
			</UButton>
		</div>
	</div>
</template>

<script setup lang="ts">
const toast = useToast();
const { settings, save } = useSettings();

const form = reactive<{
	archive_days: number | null;
	delete_days: number | null;
	auto_lock_on_close: boolean;
	customer_reopen: boolean;
}>({
	archive_days: 90,
	delete_days: null,
	auto_lock_on_close: false,
	customer_reopen: true
});

const saving = ref(false);

// empty (or a non-finite entry) means "never"; anything else is the raw day count
function toDays(value: string | number): number | null {
	if (value === '' || value == null) return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function displayValue(value: number | null): string {
	return value == null ? '' : String(value);
}

watch(
	settings,
	(value) => {
		const retention = (value?.retention as Record<string, unknown>) || {};
		const locking = (value?.locking as Record<string, unknown>) || {};
		form.archive_days = typeof retention.archive_days === 'number' ? retention.archive_days : 90;
		form.delete_days = typeof retention.delete_days === 'number' ? retention.delete_days : null;
		form.auto_lock_on_close = locking.auto_lock_on_close === true;
		form.customer_reopen = locking.customer_reopen !== false;
	},
	{ immediate: true }
);

async function onSave() {
	saving.value = true;
	try {
		await save({
			retention: { archive_days: form.archive_days, delete_days: form.delete_days },
			locking: {
				auto_lock_on_close: form.auto_lock_on_close,
				customer_reopen: form.customer_reopen
			}
		});
		toast.add({
			title: 'Retention Saved',
			description: 'Your locking and retention settings were updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Save Retention',
			description: extractServerMessage(error, 'Could not save retention settings.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
