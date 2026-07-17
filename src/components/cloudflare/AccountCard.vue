<template>
	<div
		class="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
	>
		<div class="mb-4 flex items-center gap-3">
			<UIcon
				name="mdi:cloud-outline"
				class="size-6 text-primary-500"
			/>
			<div>
				<h3 class="text-sm font-semibold">Cloudflare Account</h3>
				<p class="text-xs text-slate-500">
					Link an account to provision email routing and the support worker.
				</p>
			</div>
			<UBadge
				:color="isLinked ? 'success' : 'neutral'"
				variant="subtle"
				class="ml-auto"
				>{{ isLinked ? 'Linked' : 'Not Linked' }}</UBadge
			>
		</div>

		<div
			v-if="!loaded"
			class="flex flex-col gap-3"
		>
			<USkeleton class="h-3 w-20" />
			<USkeleton class="h-9 w-full" />
			<USkeleton class="h-3 w-20" />
			<USkeleton class="h-9 w-full" />
			<USkeleton class="h-9 w-32" />
		</div>

		<form
			v-else-if="!isLinked || replacing"
			class="flex flex-col gap-3"
			@submit.prevent="submitLink"
		>
			<p
				v-if="replacing"
				class="text-xs text-slate-500"
			>
				Enter a new API token to replace the linked credentials. The account stays connected.
			</p>
			<UFormField
				label="Account ID"
				size="sm"
			>
				<UInput
					v-model="accountId"
					placeholder="Your Cloudflare account ID"
					class="w-full"
				/>
			</UFormField>
			<UFormField
				label="API Token"
				size="sm"
				help="Requires the Email Sending: Edit permission."
			>
				<UInput
					v-model="token"
					type="password"
					placeholder="Cloudflare API token"
					class="w-full"
				/>
			</UFormField>
			<div class="flex gap-2">
				<UButton
					type="submit"
					color="primary"
					:icon="replacing ? 'mdi:key-change' : 'mdi:link-variant'"
					:loading="linking"
					:disabled="!accountId.trim() || !token.trim()"
					>{{ replacing ? 'Replace Token' : 'Link Account' }}</UButton
				>
				<UButton
					v-if="replacing"
					color="neutral"
					variant="ghost"
					icon="mdi:close"
					@click="cancelReplace"
					>Cancel</UButton
				>
			</div>
		</form>

		<div
			v-else
			class="flex flex-col gap-4"
		>
			<div class="divide-y divide-slate-100 dark:divide-slate-800">
				<div
					v-for="check in checklist"
					:key="check.label"
					class="flex items-center gap-3 py-2"
				>
					<UIcon
						:name="check.ok ? 'mdi:check-circle' : 'mdi:circle-outline'"
						:class="check.ok ? 'text-green-500' : 'text-slate-300'"
						class="size-5 shrink-0"
					/>
					<div class="min-w-0">
						<p class="text-sm font-medium">{{ check.label }}</p>
						<p
							v-if="check.detail"
							class="truncate text-xs text-slate-500"
						>
							{{ check.detail }}
						</p>
					</div>
				</div>
			</div>

			<form
				class="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800"
				@submit.prevent="submitProvision"
			>
				<UFormField
					label="Zone"
					size="sm"
					class="min-w-40 flex-1"
				>
					<USelect
						v-model="zoneId"
						:items="zoneOptions"
						placeholder="Select a zone"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					label="Worker"
					size="sm"
					class="min-w-40 flex-1"
				>
					<USelectMenu
						v-model="workerName"
						:items="workerOptions"
						create-item
						class="w-full"
						@create="onCreateWorker"
					/>
				</UFormField>
				<UButton
					type="submit"
					color="primary"
					icon="mdi:rocket-launch-outline"
					:loading="provisioning"
					:disabled="!zoneId.trim()"
					>Provision</UButton
				>
			</form>

			<div class="flex justify-between gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
				<UButton
					color="neutral"
					variant="ghost"
					icon="mdi:key-change"
					@click="startReplace"
					>Replace Token</UButton
				>
				<UButton
					color="error"
					variant="ghost"
					icon="mdi:link-off"
					:loading="unlinking"
					@click="submitUnlink"
					>Unlink Account</UButton
				>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
const toast = useToast();
const { status, loaded, isLinked, link, provision, unlink, zones, workers, fetchWorkers } =
	useCloudflare();

const accountId = ref('');
const token = ref('');
const zoneId = ref('');
const workerName = ref('smoke');
const manualWorkers = ref<string[]>([]);

const linking = ref(false);
const provisioning = ref(false);
const unlinking = ref(false);
// re-enter credentials on a linked account without a destructive unlink first
const replacing = ref(false);

function startReplace() {
	accountId.value = status.value?.account_id ?? '';
	token.value = '';
	replacing.value = true;
}

function cancelReplace() {
	replacing.value = false;
	token.value = '';
}

watch(status, (value) => {
	if (value?.zone_id) zoneId.value = value.zone_id;
	if (value?.worker_name) workerName.value = value.worker_name;
});

// load worker scripts once an account is linked
watch(
	isLinked,
	(linked) => {
		if (linked) fetchWorkers();
	},
	{ immediate: true }
);

const zoneOptions = computed(() =>
	(zones.value ?? []).map((z) => ({ label: `${z.name} (${z.id})`, value: z.id }))
);

const workerOptions = computed(() => {
	const names = new Set<string>(['smoke']);
	for (const w of workers.value ?? []) if (w?.name) names.add(w.name);
	for (const name of manualWorkers.value) if (name) names.add(name);
	return [...names];
});

function onCreateWorker(name: string) {
	const value = name.trim();
	if (!value) return;
	if (!manualWorkers.value.includes(value)) manualWorkers.value.push(value);
	workerName.value = value;
}

const checklist = computed(() => [
	{
		label: 'Account Connected',
		ok: !!status.value?.linked,
		detail: status.value?.account_id
	},
	{
		label: 'Zone Configured',
		ok: !!status.value?.zone_id,
		detail: status.value?.zone_id
	},
	{
		label: 'Worker Wired',
		ok: !!status.value?.checklist?.worker_wired,
		detail: status.value?.worker_name
	}
]);

async function submitLink() {
	linking.value = true;
	const wasReplacing = replacing.value;
	try {
		await link({ account_id: accountId.value.trim(), token: token.value.trim() });
		token.value = '';
		replacing.value = false;
		toast.add({
			title: wasReplacing ? 'Token Replaced' : 'Account Linked',
			description: wasReplacing
				? 'The Cloudflare API token was updated.'
				: 'Your Cloudflare account is connected.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Link Account',
			description: extractServerMessage(error, 'Check the account ID and token, then try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		linking.value = false;
	}
}

async function submitProvision() {
	provisioning.value = true;
	try {
		await provision({
			zone_id: zoneId.value.trim(),
			worker_name: workerName.value.trim() || undefined
		});
		toast.add({
			title: 'Worker Provisioned',
			description: 'Email routing is being configured.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Provision',
			description: extractServerMessage(error, 'Could not provision the worker. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		provisioning.value = false;
	}
}

async function submitUnlink() {
	if (!confirm('Unlink this Cloudflare account?')) return;
	unlinking.value = true;
	try {
		await unlink();
		accountId.value = '';
		token.value = '';
		toast.add({
			title: 'Account Unlinked',
			description: 'The Cloudflare account was disconnected.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Unlink',
			description: extractServerMessage(error, 'Could not unlink the account. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		unlinking.value = false;
	}
}
</script>
