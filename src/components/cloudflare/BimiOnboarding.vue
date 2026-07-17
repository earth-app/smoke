<template>
	<div class="flex flex-col gap-4">
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0">
				<p class="text-sm font-medium">BIMI Brand Logo</p>
				<p class="text-xs text-slate-500">
					Publish a BIMI record so mail clients show your logo next to sent email. Requires an
					enforcing DMARC policy. Customize the logo under
					<NuxtLink
						to="/dashboard/settings?section=branding"
						class="text-primary-600 hover:underline"
						>Branding</NuxtLink
					>.
				</p>
			</div>
			<UBadge
				:color="statusView.tone"
				variant="subtle"
				>{{ statusView.label }}</UBadge
			>
		</div>

		<UAlert
			v-if="!isLinked"
			color="neutral"
			variant="subtle"
			icon="mdi:information-outline"
			title="Link a Cloudflare Account First"
			description="Connect an account above to provision the BIMI DNS record."
		/>

		<template v-else>
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

			<UCheckbox
				v-model="autoDmarc"
				label="Add a Default DMARC Policy if Missing"
				:disabled="pending || dmarcEnforced"
				help="Publishes v=DMARC1; p=quarantine when the domain has no DMARC record. Skipped if one already exists."
			/>

			<div class="flex items-center gap-2">
				<UButton
					:icon="phase === 'success' ? 'mdi:refresh' : 'mdi:shield-check-outline'"
					color="primary"
					:loading="pending"
					:disabled="pending"
					@click="run"
				>
					{{ phase === 'success' ? 'Re-run BIMI Setup' : 'Provision BIMI' }}
				</UButton>
				<span
					v-if="pending"
					class="text-xs text-slate-500"
					>Publishing the record...</span
				>
			</div>

			<UAlert
				v-if="!dmarcEnforced && (record || phase === 'success')"
				color="warning"
				variant="subtle"
				icon="mdi:alert-outline"
				title="DMARC Not Enforcing"
				:description="dmarcDescription"
			/>

			<UAlert
				v-if="phase === 'error'"
				color="error"
				variant="subtle"
				icon="mdi:alert-circle"
				title="Provisioning Failed"
				:description="errorMessage"
			/>

			<div
				v-if="logoUrl"
				class="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
			>
				<img
					:src="logoUrl"
					alt="BIMI logo preview"
					class="size-10 rounded"
				/>
				<div class="min-w-0">
					<p class="text-xs font-medium text-slate-600 dark:text-slate-300">Logo URL</p>
					<button
						type="button"
						class="inline-flex max-w-full items-center gap-1 truncate font-mono text-xs hover:text-primary-600"
						@click="copy(logoUrl)"
					>
						<span class="truncate">{{ logoUrl }}</span>
						<UIcon
							name="mdi:content-copy"
							class="size-3 shrink-0 opacity-60"
						/>
					</button>
				</div>
			</div>

			<div
				v-if="record"
				class="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
			>
				<div
					class="border-b border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60"
				>
					<p class="text-xs font-medium text-slate-600 dark:text-slate-300">DNS Record</p>
				</div>
				<div class="overflow-x-auto">
					<table class="w-full text-left text-xs">
						<thead class="text-slate-500">
							<tr class="border-b border-slate-100 dark:border-slate-800">
								<th class="px-3 py-2 font-medium">Type</th>
								<th class="px-3 py-2 font-medium">Name</th>
								<th class="px-3 py-2 font-medium">Value</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td class="px-3 py-2 font-mono">{{ record.type }}</td>
								<td class="px-3 py-2">
									<button
										type="button"
										class="inline-flex max-w-64 items-center gap-1 truncate font-mono hover:text-primary-600"
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
										class="inline-flex max-w-80 items-center gap-1 truncate font-mono hover:text-primary-600"
										@click="copy(record.content)"
									>
										<span class="truncate">{{ record.content }}</span>
										<UIcon
											name="mdi:content-copy"
											class="size-3 shrink-0 opacity-60"
										/>
									</button>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>
		</template>
	</div>
</template>

<script setup lang="ts">
type BimiRecord = { type: string; name: string; content: string };
type DmarcStatus = {
	present: boolean;
	policy: string | null;
	pct: number | null;
	enforced: boolean;
};
type BimiStatus = {
	configured: boolean;
	needs_link?: boolean;
	needs_dmarc?: boolean;
	domain: string;
	logo_url: string;
	record: string | null;
	dmarc: DmarcStatus | null;
};
type ProvisionResult = {
	domain: string;
	record: BimiRecord;
	logo_url: string;
	dmarc: DmarcStatus;
	dmarc_created: boolean;
};

type Phase = 'idle' | 'provisioning' | 'success' | 'error';

const toast = useToast();
const { sessionToken } = useAuth();
const { status: cfStatus, isLinked } = useCloudflare();

const requestFetch = useRequestFetch();
const phase = ref<Phase>('idle');
const errorMessage = ref('');
const status = ref<BimiStatus | null>(null);
const result = ref<ProvisionResult | null>(null);
const selectedZoneId = ref('');
const autoDmarc = ref(false);

const pending = computed(() => phase.value === 'provisioning');

const record = computed<BimiRecord | null>(() => {
	if (result.value?.record) return result.value.record;
	// reconstruct a display row from the live status record string
	if (status.value?.record && status.value.domain)
		return {
			type: 'TXT',
			name: `default._bimi.${status.value.domain}`,
			content: status.value.record
		};
	return null;
});

const logoUrl = computed(() => result.value?.logo_url || status.value?.logo_url || '');

const dmarcEnforced = computed(
	() => result.value?.dmarc?.enforced ?? status.value?.dmarc?.enforced ?? false
);

const dmarcDescription = computed(() => {
	const policy = result.value?.dmarc?.policy ?? status.value?.dmarc?.policy;
	if (!policy)
		return 'No DMARC record found. BIMI logos only display once DMARC enforces (p=quarantine or p=reject).';
	return `Your DMARC policy is p=${policy}. BIMI needs p=quarantine or p=reject at full coverage to display.`;
});

const zoneOptions = computed(() =>
	(cfStatus.value?.zones ?? []).map((z) => ({ label: `${z.name} (${z.id})`, value: z.id }))
);

watch(
	[cfStatus, zoneOptions],
	() => {
		if (selectedZoneId.value) return;
		selectedZoneId.value =
			cfStatus.value?.zone_id ||
			(zoneOptions.value.length === 1 ? zoneOptions.value[0]!.value : '');
	},
	{ immediate: true }
);

const statusView = computed(() => {
	const s = status.value;
	if (s?.configured) return { tone: 'success' as const, label: 'Configured' };
	if (s?.record && !s?.dmarc?.enforced) return { tone: 'warning' as const, label: 'Needs DMARC' };
	if (s?.record) return { tone: 'warning' as const, label: 'Pending' };
	return { tone: 'neutral' as const, label: 'Not Configured' };
});

function authHeaders(): Record<string, string> {
	return sessionToken.value ? { Authorization: `Bearer ${sessionToken.value}` } : {};
}

async function loadStatus() {
	try {
		status.value = await requestFetch<BimiStatus>('/api/cloudflare/bimi-status', {
			cache: 'no-store',
			credentials: 'include',
			headers: authHeaders()
		});
	} catch {
		// leave null; the badge falls back to "Not Configured"
	}
}
onMounted(loadStatus);

async function copy(value: string) {
	try {
		await navigator.clipboard.writeText(value);
		toast.add({ title: 'Copied', icon: 'mdi:check', color: 'success', duration: 1500 });
	} catch {
		toast.add({ title: 'Copy Failed', icon: 'mdi:alert', color: 'error', duration: 2000 });
	}
}

async function run() {
	errorMessage.value = '';
	phase.value = 'provisioning';
	try {
		result.value = await $fetch<ProvisionResult>('/api/cloudflare/provision-bimi', {
			method: 'POST',
			credentials: 'include',
			headers: authHeaders(),
			body: { zone_id: selectedZoneId.value || undefined, auto_dmarc: autoDmarc.value }
		});
		phase.value = 'success';
		await loadStatus();
		toast.add({
			title: 'BIMI Record Published',
			description: dmarcEnforced.value
				? 'Your brand logo is set up.'
				: 'Record added. Enforce DMARC to make the logo display.',
			icon: 'mdi:check',
			color: dmarcEnforced.value ? 'success' : 'warning',
			duration: 4000
		});
	} catch (error) {
		phase.value = 'error';
		errorMessage.value = extractServerMessage(error, 'Could not provision the BIMI record.');
	}
}
</script>
