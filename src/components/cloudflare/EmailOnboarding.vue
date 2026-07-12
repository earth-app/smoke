<template>
	<div class="flex flex-col gap-4">
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0">
				<p class="text-sm font-medium">Cloudflare Email Sending</p>
				<p class="text-xs text-slate-500">
					Onboard your support domain so Smoke can send replies. This enables Email Sending and
					returns the DKIM / SPF / MX records to add.
				</p>
			</div>
			<UBadge
				:color="statusView.tone"
				variant="subtle"
				>{{ statusView.label }}</UBadge
			>
		</div>

		<UFormField
			v-if="zoneOptions.length > 1"
			label="Zone"
			size="sm"
			help="The Cloudflare zone that hosts your support domain."
		>
			<USelect
				v-model="selectedZoneId"
				:items="zoneOptions"
				:disabled="pending"
				class="w-full"
			/>
		</UFormField>

		<div class="flex items-center gap-2">
			<UButton
				:icon="phase === 'success' ? 'mdi:refresh' : 'mdi:email-fast-outline'"
				color="primary"
				:loading="pending"
				:disabled="pending"
				@click="run"
			>
				{{ buttonLabel }}
			</UButton>
			<span
				v-if="phase === 'checking'"
				class="text-xs text-slate-500"
				>Checking credentials...</span
			>
			<span
				v-else-if="phase === 'provisioning'"
				class="text-xs text-slate-500"
				>Enabling email sending...</span
			>
		</div>

		<UAlert
			v-if="phase === 'error'"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle"
			title="Onboarding Failed"
			:description="errorMessage"
		/>

		<UAlert
			v-else-if="phase === 'success' && result"
			:color="result.status?.configured ? 'success' : 'warning'"
			variant="subtle"
			:icon="result.status?.configured ? 'mdi:check-circle' : 'mdi:information-outline'"
			:title="result.status?.configured ? 'Email Sending Enabled' : 'Almost There'"
			:description="successDescription"
		/>

		<div
			v-if="result && result.records.length > 0"
			class="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
		>
			<div
				class="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60"
			>
				<p class="text-xs font-medium text-slate-600 dark:text-slate-300">DNS Records</p>
				<span
					v-if="result.auto_created"
					class="text-[11px] text-green-600 dark:text-green-400"
					>Added automatically</span
				>
				<span
					v-else
					class="text-[11px] text-slate-500"
					>Add these to your DNS</span
				>
			</div>
			<div class="overflow-x-auto">
				<table class="w-full text-left text-xs">
					<thead class="text-slate-500">
						<tr class="border-b border-slate-100 dark:border-slate-800">
							<th class="px-3 py-2 font-medium">Type</th>
							<th class="px-3 py-2 font-medium">Name</th>
							<th class="px-3 py-2 font-medium">Value</th>
							<th class="px-3 py-2 font-medium">Priority</th>
						</tr>
					</thead>
					<tbody>
						<tr
							v-for="(record, index) in result.records"
							:key="index"
							class="border-b border-slate-50 last:border-0 dark:border-slate-800/60"
						>
							<td class="px-3 py-2 font-mono">{{ record.type }}</td>
							<td class="px-3 py-2">
								<button
									type="button"
									class="inline-flex max-w-[16rem] items-center gap-1 truncate font-mono hover:text-primary-600"
									@click="copy(record.name)"
								>
									<span class="truncate">{{ record.name }}</span>
									<UIcon
										name="mdi:content-copy"
										class="size-3 shrink-0 opacity-60"
									/>
								</button>
							</td>
							<td class="px-3 py-2">
								<button
									type="button"
									class="inline-flex max-w-[20rem] items-center gap-1 truncate font-mono hover:text-primary-600"
									@click="copy(record.content)"
								>
									<span class="truncate">{{ record.content }}</span>
									<UIcon
										name="mdi:content-copy"
										class="size-3 shrink-0 opacity-60"
									/>
								</button>
							</td>
							<td class="px-3 py-2 font-mono text-slate-500">{{ record.priority ?? '-' }}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{ token?: string; accountId?: string; zoneId?: string }>();
const emit = defineEmits<{ provisioned: [] }>();

type CfDnsRecord = { type: string; name: string; content: string; priority?: number };
type EmailConfigStatus = {
	configured: boolean;
	transport: 'cloudflare' | 'smtp' | null;
	needsOnboarding: boolean;
	reason?: string;
};
type ProvisionResult = {
	domain: string;
	subdomain: string;
	enabled: boolean;
	records: CfDnsRecord[];
	created: string[];
	auto_created: boolean;
	status?: EmailConfigStatus;
};
type TestResult = { valid: boolean; message?: string; zones?: { id: string; name: string }[] };

type Phase = 'idle' | 'checking' | 'provisioning' | 'success' | 'error';

const toast = useToast();
const { sessionToken } = useAuth();
const { status: cfStatus } = useCloudflare();
const { fetchSettings } = useSettings();

const phase = ref<Phase>('idle');
const errorMessage = ref('');
const result = ref<ProvisionResult | null>(null);
const testZones = ref<{ id: string; name: string }[]>([]);
const selectedZoneId = ref(props.zoneId || '');

const pending = computed(() => phase.value === 'checking' || phase.value === 'provisioning');

const zoneOptions = computed(() => {
	const map = new Map<string, string>();
	for (const z of cfStatus.value?.zones ?? []) map.set(z.id, z.name);
	for (const z of testZones.value) map.set(z.id, z.name);
	return [...map.entries()].map(([value, name]) => ({ label: `${name} (${value})`, value }));
});

// seed the selected zone from props / linked status when nothing is chosen yet
watch(
	[() => props.zoneId, cfStatus, zoneOptions],
	() => {
		if (selectedZoneId.value) return;
		selectedZoneId.value =
			props.zoneId ||
			cfStatus.value?.zone_id ||
			(zoneOptions.value.length === 1 ? zoneOptions.value[0]!.value : '');
	},
	{ immediate: true }
);

const buttonLabel = computed(() =>
	phase.value === 'success' ? 'Re-run Onboarding' : 'Set Up Email Sending'
);

const statusView = computed(() => {
	const s = result.value?.status;
	if (s?.configured) return { tone: 'success' as const, label: 'Configured' };
	if (s?.needsOnboarding) return { tone: 'warning' as const, label: 'Needs Onboarding' };
	return { tone: 'neutral' as const, label: 'Not Configured' };
});

const successDescription = computed(() => {
	const s = result.value?.status;
	if (s?.configured) return `Sending from ${result.value?.domain} is ready.`;
	return s?.reason || 'Add the DNS records below, then re-run onboarding to verify.';
});

function authHeaders(): Record<string, string> {
	return sessionToken.value ? { Authorization: `Bearer ${sessionToken.value}` } : {};
}

async function copy(value: string) {
	try {
		await navigator.clipboard.writeText(value);
		toast.add({
			title: 'Copied',
			icon: 'mdi:check',
			color: 'success',
			duration: 1500
		});
	} catch {
		toast.add({ title: 'Copy Failed', icon: 'mdi:alert', color: 'error', duration: 2000 });
	}
}

async function run() {
	errorMessage.value = '';
	phase.value = 'checking';
	try {
		// 1) confirm the credentials work and discover zones
		const test = await $fetch<TestResult>('/api/cloudflare/test', {
			method: 'POST',
			credentials: 'include',
			headers: authHeaders(),
			body: { token: props.token || undefined, account_id: props.accountId || undefined }
		});
		if (!test.valid) {
			phase.value = 'error';
			errorMessage.value = test.message || 'Enter a valid Cloudflare API token, then try again.';
			return;
		}
		testZones.value = test.zones ?? [];
		if (!selectedZoneId.value && testZones.value.length === 1) {
			selectedZoneId.value = testZones.value[0]!.id;
		}
		if (!selectedZoneId.value) {
			phase.value = 'error';
			errorMessage.value = 'Select the Cloudflare zone that hosts your support domain.';
			return;
		}

		// 2) enable email sending + fetch the dns records
		phase.value = 'provisioning';
		result.value = await $fetch<ProvisionResult>('/api/cloudflare/provision-email', {
			method: 'POST',
			credentials: 'include',
			headers: authHeaders(),
			body: {
				token: props.token || undefined,
				account_id: props.accountId || undefined,
				zone_id: selectedZoneId.value
			}
		});
		phase.value = 'success';
		await fetchSettings(true);
		emit('provisioned');
	} catch (error) {
		phase.value = 'error';
		errorMessage.value = extractServerMessage(error, 'Could not enable email sending.');
	}
}

defineExpose({ run, result, phase });
</script>
