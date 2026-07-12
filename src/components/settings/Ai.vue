<template>
	<div
		class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
	>
		<div>
			<h3 class="text-sm font-semibold">AI Replies</h3>
			<p class="text-xs text-slate-500">
				Let agents draft customer replies with Cloudflare AI. Drafts are always reviewed before they
				are sent - nothing is delivered automatically.
			</p>
		</div>

		<UAlert
			color="info"
			variant="subtle"
			icon="mdi:information-outline"
			title="Uses Your Linked Cloudflare Account"
			description="AI reuses the Cloudflare account and API token you already linked. No new secret is stored, but you may need to grant your token the Workers AI permission for requests to succeed."
		/>

		<UAlert
			v-if="!aiStatus.capable"
			color="warning"
			variant="subtle"
			icon="mdi:alert"
			title="Workers AI Not Available"
			:description="
				aiStatus.reason || 'Cloudflare Workers AI is not available for your linked account.'
			"
		/>

		<UFormField
			label="Enable AI Replies"
			help="Off by default. When on, agents see a Draft with AI button in the reply composer."
		>
			<USwitch
				v-model="form.enabled"
				:disabled="!aiStatus.capable && !form.enabled"
			/>
		</UFormField>

		<UFormField
			label="Model"
			help="Pick a Workers AI text model, or type any model id from the catalog."
		>
			<USelectMenu
				v-model="form.model"
				:items="modelItems"
				create-item
				class="w-full sm:w-96"
				@create="onCreateModel"
			/>
		</UFormField>

		<UFormField
			label="System Prompt Additions"
			help="Appended to the built-in support instructions (e.g. tone, product names, escalation rules). Optional."
		>
			<UTextarea
				v-model="form.systemAppend"
				:rows="4"
				autoresize
				placeholder="Always mention our 30-day refund window when relevant."
				class="w-full"
			/>
		</UFormField>

		<div class="grid gap-4 sm:grid-cols-2">
			<UFormField
				label="Temperature"
				help="Higher is more creative. Leave blank for the model default."
			>
				<UInput
					v-model="form.temperature"
					type="number"
					step="0.1"
					min="0"
					max="2"
					placeholder="0.6"
					class="w-full"
				/>
			</UFormField>

			<UFormField
				label="Max Tokens"
				help="Caps the reply length. Leave blank for the model default."
			>
				<UInput
					v-model="form.maxTokens"
					type="number"
					min="1"
					placeholder="256"
					class="w-full"
				/>
			</UFormField>
		</div>

		<div class="flex justify-end">
			<UButton
				color="primary"
				icon="mdi:content-save-outline"
				:loading="saving"
				@click="onSave"
			>
				Save AI Settings
			</UButton>
		</div>
	</div>
</template>

<script setup lang="ts">
const toast = useToast();
const { settings, save } = useSettings();
const { sessionToken } = useAuth();

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// default capable so the switch never flashes disabled before the check resolves
const aiStatus = reactive<{ capable: boolean; reason?: string }>({ capable: true });

onMounted(async () => {
	try {
		const headers: Record<string, string> = {};
		if (sessionToken.value) headers.Authorization = `Bearer ${sessionToken.value}`;
		const res = await $fetch<{ capable: boolean; reason?: string }>('/api/cloudflare/ai-status', {
			credentials: 'include',
			headers
		});
		aiStatus.capable = res.capable;
		aiStatus.reason = res.reason;
	} catch {
		// leave defaults; the server 422 still guards a save
	}
});

const modelItems = ref<string[]>([
	'@cf/meta/llama-3.3-70b-instruct-fp8-fast',
	'@cf/meta/llama-3.1-8b-instruct-fp8',
	'@cf/meta/llama-3.2-3b-instruct',
	'@cf/mistral/mistral-small-3.1-24b-instruct',
	'@cf/qwen/qwen3-30b-a3b-fp8'
]);

const form = reactive({
	enabled: false,
	model: DEFAULT_MODEL,
	systemAppend: '',
	temperature: '',
	maxTokens: ''
});

const saving = ref(false);

watch(
	settings,
	(value) => {
		const ai = (value?.ai as Record<string, unknown> | undefined) || {};
		form.enabled = ai.enabled === true;
		form.model = typeof ai.model === 'string' && ai.model ? ai.model : DEFAULT_MODEL;
		if (!modelItems.value.includes(form.model)) modelItems.value.push(form.model);
		form.systemAppend = typeof ai.system_append === 'string' ? ai.system_append : '';
		form.temperature = typeof ai.temperature === 'number' ? String(ai.temperature) : '';
		form.maxTokens = typeof ai.max_tokens === 'number' ? String(ai.max_tokens) : '';
	},
	{ immediate: true }
);

function onCreateModel(item: string) {
	const value = item.trim();
	if (!value) return;
	if (!modelItems.value.includes(value)) modelItems.value.push(value);
	form.model = value;
}

async function onSave() {
	saving.value = true;
	try {
		const ai: Record<string, unknown> = {
			enabled: form.enabled,
			model: form.model.trim() || DEFAULT_MODEL
		};
		const append = form.systemAppend.trim();
		if (append) ai.system_append = append;
		const temperature = Number.parseFloat(form.temperature);
		if (Number.isFinite(temperature)) ai.temperature = temperature;
		const maxTokens = Number.parseInt(form.maxTokens, 10);
		if (Number.isFinite(maxTokens)) ai.max_tokens = maxTokens;

		await save({ ai });
		toast.add({
			title: 'AI Settings Saved',
			description: 'Your AI reply configuration was updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Save AI Settings',
			description: extractServerMessage(error, 'Could not save AI settings.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
