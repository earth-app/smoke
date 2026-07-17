<template>
	<div
		class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
	>
		<div>
			<h3 class="text-sm font-semibold">Role Icons</h3>
			<p class="text-xs text-slate-500">
				Default avatar icons per role, shown when a staff member has no avatar of their own.
			</p>
		</div>

		<Skeleton
			v-if="!loaded"
			variant="line"
			:repeat="3"
			:gap="4"
			height="2.25rem"
		/>
		<div
			v-else
			class="flex flex-col gap-4"
		>
			<UFormField
				v-for="row in roles"
				:key="row.key"
				:label="row.label"
			>
				<UInput
					v-model="form[row.key]"
					:placeholder="row.placeholder"
					class="w-full"
				>
					<template #leading>
						<UIcon
							:name="form[row.key] || 'mdi:image-outline'"
							:class="form[row.key] ? 'text-default' : 'text-dimmed'"
						/>
					</template>
				</UInput>
			</UFormField>
		</div>

		<div class="flex justify-end">
			<UButton
				color="primary"
				icon="mdi:content-save-outline"
				:loading="saving"
				:disabled="!loaded"
				@click="onSave"
				>Save Role Icons</UButton
			>
		</div>
	</div>
</template>

<script setup lang="ts">
const toast = useToast();
const { settings, loaded, save } = useSettings();

type RoleKey = 'agent' | 'manager' | 'admin';

const roles: { key: RoleKey; label: string; placeholder: string }[] = [
	{ key: 'agent', label: 'Agent', placeholder: 'mdi:account' },
	{ key: 'manager', label: 'Manager', placeholder: 'mdi:account-tie' },
	{ key: 'admin', label: 'Admin', placeholder: 'mdi:shield-account' }
];

const form = reactive<Record<RoleKey, string>>({ agent: '', manager: '', admin: '' });
const saving = ref(false);

watch(
	settings,
	(value) => {
		const icons = (value?.role_icons || {}) as Partial<Record<RoleKey, string>>;
		form.agent = icons.agent || '';
		form.manager = icons.manager || '';
		form.admin = icons.admin || '';
	},
	{ immediate: true }
);

async function onSave() {
	saving.value = true;
	try {
		// omit blank fields so clearing a field removes that role's icon
		const role_icons: Partial<Record<RoleKey, string>> = {};
		for (const key of ['agent', 'manager', 'admin'] as RoleKey[]) {
			if (form[key].trim()) role_icons[key] = form[key].trim();
		}
		await save({ role_icons });
		toast.add({
			title: 'Role Icons Saved',
			description: 'Default role avatars were updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Save Role Icons',
			description: extractServerMessage(error, 'Could not save role icons. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
