<template>
	<div
		class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
	>
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0">
				<p class="text-sm font-medium">Inbound Email Routing</p>
				<p class="text-xs text-slate-500">
					Wire Cloudflare Email Routing to this worker so customer replies land back in Smoke.
					Enables routing, creates DNS, sets the catch-all rule, and registers the destination
					address.
				</p>
			</div>
			<UBadge
				:color="wiredView.tone"
				variant="subtle"
				>{{ wiredView.label }}</UBadge
			>
		</div>

		<div class="flex flex-wrap items-end gap-2">
			<UFormField
				label="Zone"
				size="sm"
				class="min-w-48 flex-1"
				help="The Cloudflare zone that hosts your support domain."
			>
				<USelect
					v-model="selectedZoneId"
					:items="zoneOptions"
					:disabled="loadingZones || provisioning"
					placeholder="Select a zone"
					class="w-full"
				/>
			</UFormField>
			<UButton
				color="neutral"
				variant="soft"
				icon="mdi:refresh"
				:loading="loadingZones"
				:disabled="provisioning"
				@click="loadZones"
				>Refresh Zones</UButton
			>
		</div>

		<UFormField
			label="Worker"
			size="sm"
			help="The worker script that receives inbound mail; defaults to smoke."
		>
			<USelectMenu
				v-model="workerName"
				:items="workerOptions"
				create-item
				:disabled="provisioning"
				class="w-full sm:w-96"
				@create="onCreateWorker"
			/>
		</UFormField>

		<div class="flex items-center gap-2">
			<UButton
				color="primary"
				icon="mdi:email-arrow-left-outline"
				:loading="provisioning"
				:disabled="!selectedZoneId"
				@click="submitProvision"
				>Provision Inbound Routing</UButton
			>
			<span
				v-if="provisioning"
				class="text-xs text-slate-500"
				>Configuring email routing...</span
			>
		</div>

		<UAlert
			v-if="errorMessage"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle"
			title="Provisioning Failed"
			:description="errorMessage"
		/>

		<div
			v-if="steps.length > 0"
			class="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800"
		>
			<div
				v-for="stepItem in steps"
				:key="stepItem.name"
				class="flex items-start gap-3 px-3 py-2"
			>
				<UIcon
					:name="stepItem.ok ? 'mdi:check-circle' : 'mdi:alert-circle'"
					:class="stepItem.ok ? 'text-green-500' : 'text-red-500'"
					class="mt-0.5 size-5 shrink-0"
				/>
				<div class="min-w-0">
					<p class="text-sm font-medium">{{ stepLabel(stepItem.name) }}</p>
					<p
						v-if="stepItem.detail"
						class="truncate text-xs text-slate-500"
					>
						{{ stepItem.detail }}
					</p>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type {
	CloudflareProvisionStep,
	CloudflareWorker,
	CloudflareZone
} from '~/stores/cloudflare';

const props = defineProps<{ token?: string; accountId?: string; supportEmail?: string }>();
const emit = defineEmits<{ provisioned: [] }>();

type TestResult = { valid: boolean; message?: string; zones?: CloudflareZone[] };

const toast = useToast();
const { sessionToken } = useAuth();
const { status: cfStatus, zones: statusZones, workers, fetchWorkers, provision } = useCloudflare();

// setup passes creds inline (no sealed token yet); settings uses the sealed token
const inlineCreds = computed(() => !!(props.token?.trim() && props.accountId?.trim()));

const testZones = ref<CloudflareZone[]>([]);
const selectedZoneId = ref('');
const workerName = ref('smoke');
const manualWorkers = ref<string[]>([]);

const loadingZones = ref(false);
const provisioning = ref(false);
const errorMessage = ref('');
const steps = ref<CloudflareProvisionStep[]>([]);

const STEP_LABELS: Record<string, string> = {
	enable_email_routing: 'Email Routing Enabled',
	dns_records: 'DNS Records',
	catch_all_worker: 'Catch-All Rule Wired',
	destination_address: 'Destination Address Registered'
};
function stepLabel(name: string): string {
	return STEP_LABELS[name] || name;
}

const zoneOptions = computed(() => {
	const byId = new Map<string, CloudflareZone>();
	for (const z of statusZones.value ?? []) byId.set(z.id, z);
	for (const z of testZones.value) byId.set(z.id, z); // test result carries the capability flags
	const items = [...byId.values()].map((z) => {
		// capability is only known after a credential test; leave unknown zones selectable
		const known = z.dns !== undefined || z.routing !== undefined;
		const capable = !!(z.dns && z.routing);
		return {
			label:
				known && !capable ? `${z.name} (${z.id}) - no DNS/email access` : `${z.name} (${z.id})`,
			value: z.id,
			disabled: known && !capable
		};
	});
	// provision-ready zones first; the token can't provision the disabled ones
	return items.sort((a, b) => Number(a.disabled) - Number(b.disabled));
});

const workerOptions = computed(() => {
	const names = new Set<string>(['smoke']);
	for (const w of (workers.value ?? []) as CloudflareWorker[]) if (w?.name) names.add(w.name);
	for (const name of manualWorkers.value) if (name) names.add(name);
	return [...names];
});

const wiredView = computed(() => {
	if (cfStatus.value?.checklist?.worker_wired) {
		return { tone: 'success' as const, label: 'Wired' };
	}
	return { tone: 'neutral' as const, label: 'Not Wired' };
});

// seed the zone from the linked status / a single discovered zone
watch(
	[statusZones, testZones, () => cfStatus.value?.zone_id],
	() => {
		if (selectedZoneId.value) return;
		// prefer a provision-ready zone; only auto-pick when exactly one is usable
		const usable = zoneOptions.value.filter((o) => !o.disabled);
		selectedZoneId.value = cfStatus.value?.zone_id || (usable.length === 1 ? usable[0]!.value : '');
	},
	{ immediate: true }
);

watch(
	() => cfStatus.value?.worker_name,
	(name) => {
		if (name) workerName.value = name;
	},
	{ immediate: true }
);

onMounted(() => {
	fetchWorkers();
	if (inlineCreds.value) loadZones();
});

function authHeaders(): Record<string, string> {
	return sessionToken.value ? { Authorization: `Bearer ${sessionToken.value}` } : {};
}

function onCreateWorker(name: string) {
	const value = name.trim();
	if (!value) return;
	if (!manualWorkers.value.includes(value)) manualWorkers.value.push(value);
	workerName.value = value;
}

async function loadZones() {
	loadingZones.value = true;
	errorMessage.value = '';
	try {
		const test = await $fetch<TestResult>('/api/cloudflare/test', {
			method: 'POST',
			credentials: 'include',
			headers: authHeaders(),
			body: { token: props.token || undefined, account_id: props.accountId || undefined }
		});
		if (!test.valid) {
			errorMessage.value = test.message || 'Enter a valid Cloudflare API token, then try again.';
			return;
		}
		testZones.value = test.zones ?? [];
		if (!selectedZoneId.value && testZones.value.length === 1) {
			selectedZoneId.value = testZones.value[0]!.id;
		}
	} catch (error) {
		errorMessage.value = extractServerMessage(error, 'Could not load your Cloudflare zones.');
	} finally {
		loadingZones.value = false;
	}
}

async function submitProvision() {
	if (!selectedZoneId.value) {
		errorMessage.value = 'Select the Cloudflare zone that hosts your support domain.';
		return;
	}
	provisioning.value = true;
	errorMessage.value = '';
	try {
		const result = await provision({
			zone_id: selectedZoneId.value,
			worker_name: (workerName.value || 'smoke').trim(),
			support_email: props.supportEmail?.trim() || undefined,
			token: props.token?.trim() || undefined,
			account_id: props.accountId?.trim() || undefined
		});
		steps.value = result?.steps ?? [];
		const failed = steps.value.some((s) => !s.ok);
		toast.add({
			title: failed ? 'Inbound Routing Partially Provisioned' : 'Inbound Routing Provisioned',
			description: failed
				? 'Some steps did not complete; review the results below.'
				: 'Cloudflare Email Routing is wired to your worker.',
			icon: failed ? 'mdi:alert-circle-outline' : 'mdi:check',
			color: failed ? 'warning' : 'success',
			duration: failed ? 4000 : 3000
		});
		emit('provisioned');
	} catch (error) {
		errorMessage.value = extractServerMessage(error, 'Could not provision inbound routing.');
		toast.add({
			title: 'Failed to Provision Inbound Routing',
			description: errorMessage.value,
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		provisioning.value = false;
	}
}

defineExpose({ submitProvision, loadZones, steps });
</script>
