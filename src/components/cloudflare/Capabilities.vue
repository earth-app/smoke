<template>
	<div class="flex flex-col gap-3">
		<div class="flex items-center justify-between gap-3">
			<div>
				<p class="text-sm font-medium">Credential Check</p>
				<p class="text-xs text-slate-500">Test your token and see what Smoke can automate.</p>
			</div>
			<UButton
				icon="mdi:shield-search"
				color="neutral"
				variant="soft"
				:loading="testing"
				@click="test"
			>
				Test Credentials
			</UButton>
		</div>

		<UAlert
			v-if="result && !result.valid"
			color="error"
			variant="subtle"
			icon="mdi:alert-circle"
			:title="result.status === 'missing' ? 'No Token Provided' : 'Token Invalid'"
			:description="result.message || 'Enter a valid Cloudflare API token, then test again.'"
		/>

		<template v-if="result?.valid">
			<div class="flex flex-wrap items-center gap-2">
				<UBadge
					color="success"
					variant="subtle"
					icon="mdi:check"
					>Token {{ result.status }}</UBadge
				>
				<UBadge
					v-if="result.account_ok === true"
					color="success"
					variant="subtle"
					icon="mdi:check"
					>Account OK ({{ result.zones?.length || 0 }} zones)</UBadge
				>
				<UBadge
					v-else-if="result.account_ok === false"
					color="warning"
					variant="subtle"
					icon="mdi:alert"
					>Account Not Readable</UBadge
				>
			</div>
			<div class="grid gap-2 sm:grid-cols-2">
				<div
					v-for="c in result.capabilities"
					:key="c.key"
					class="flex items-start gap-2 rounded-lg border p-3"
					:class="
						c.granted
							? 'border-green-200 bg-green-50/40 dark:border-green-900/40 dark:bg-green-950/20'
							: 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900'
					"
				>
					<UIcon
						:name="c.granted ? 'mdi:check-circle' : 'mdi:close-circle-outline'"
						class="mt-0.5 size-5 shrink-0"
						:class="c.granted ? 'text-green-600' : 'text-slate-400'"
					/>
					<div class="min-w-0">
						<p class="text-sm font-medium">{{ c.label }}</p>
						<p class="text-xs text-slate-500">{{ c.description }}</p>
						<p class="mt-1 text-[11px] text-slate-400">Needs: {{ c.permission }}</p>
					</div>
				</div>
			</div>
		</template>

		<UAlert
			color="info"
			variant="subtle"
			icon="mdi:information-outline"
			title="Recommended Token Permissions"
		>
			<template #description>
				<ul class="mt-1 list-disc space-y-0.5 pl-4 text-xs">
					<li
						v-for="p in permissionHints"
						:key="p"
					>
						{{ p }}
					</li>
				</ul>
			</template>
		</UAlert>
	</div>
</template>

<script setup lang="ts">
const props = defineProps<{ token?: string; accountId?: string }>();
const { sessionToken } = useAuth();
const toast = useToast();

type Cap = {
	key: string;
	label: string;
	permission: string;
	description: string;
	granted: boolean;
};
type Result = {
	valid: boolean;
	status: string;
	message?: string;
	scopes: string[];
	capabilities: Cap[];
	account_ok?: boolean | null;
	zones?: { id: string; name: string }[];
};

const result = ref<Result | null>(null);
const testing = ref(false);

const permissionHints = [
	'Account > Email Routing Addresses > Edit',
	'Zone > Email Routing > Edit',
	'Zone > DNS > Edit (to auto-create MX / SPF / DKIM)',
	'Account > Workers Scripts > Edit (for the inbound worker)',
	'Account > Workers AI > Read (for AI-powered replies)',
	'Zone > Email > Edit (for Cloudflare Email Sending onboarding)',
	'Zone > Zone > Read'
];

async function test() {
	testing.value = true;
	try {
		const headers: Record<string, string> = {};
		if (sessionToken.value) headers.Authorization = `Bearer ${sessionToken.value}`;
		result.value = await $fetch<Result>('/api/cloudflare/test', {
			method: 'POST',
			credentials: 'include',
			headers,
			body: { token: props.token || undefined, account_id: props.accountId || undefined }
		});
	} catch (e) {
		toast.add({
			title: 'Test Failed',
			description: extractServerMessage(e, 'Could not reach Cloudflare.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		testing.value = false;
	}
}

defineExpose({ test, result });
</script>
