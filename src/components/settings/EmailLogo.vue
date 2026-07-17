<template>
	<div
		class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
	>
		<div class="flex items-start justify-between gap-3">
			<div>
				<h3 class="text-sm font-semibold">Email Logo (BIMI)</h3>
				<p class="text-xs text-slate-500">
					The brand mark mail clients show next to your email. Rendered as a BIMI-compliant SVG.
				</p>
			</div>
			<UBadge
				:color="provisioned ? 'success' : 'neutral'"
				variant="subtle"
				>{{ provisioned ? 'Provisioned' : 'Not Provisioned' }}</UBadge
			>
		</div>

		<UAlert
			v-if="!checkingStatus && !provisioned"
			color="warning"
			variant="subtle"
			icon="mdi:cloud-alert-outline"
			title="Set Up Provisioning First"
			description="Publish the BIMI DNS record in the Cloudflare tab before customizing the logo."
		>
			<template #actions>
				<UButton
					color="warning"
					variant="soft"
					size="xs"
					icon="mdi:cloud-outline"
					to="/dashboard/settings?section=cloudflare"
					>Go to Cloudflare</UButton
				>
			</template>
		</UAlert>

		<div class="flex flex-col gap-4 sm:flex-row">
			<div class="flex flex-col items-center gap-2">
				<div
					class="flex size-28 items-center justify-center rounded-lg border border-slate-200 bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] dark:border-slate-700"
				>
					<img
						:src="previewUrl"
						alt="BIMI logo preview"
						class="size-20"
					/>
				</div>
				<span class="text-xs text-slate-400">Live Preview</span>
			</div>

			<div class="flex flex-1 flex-col gap-3">
				<UCheckbox
					v-model="form.enabled"
					label="Enable BIMI Logo"
					:disabled="disabled"
				/>

				<UFormField
					label="Icon"
					size="sm"
					help="An Iconify icon name, e.g. mdi:earth."
				>
					<UInput
						v-model="form.icon"
						placeholder="mdi:earth"
						:disabled="disabled"
						class="w-full"
					/>
				</UFormField>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<UFormField
						label="Fill Color"
						size="sm"
					>
						<div class="flex items-center gap-2">
							<input
								v-model="form.fill"
								type="color"
								:disabled="disabled"
								class="h-9 w-12 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
							/>
							<UInput
								v-model="form.fill"
								placeholder="#000000"
								:disabled="disabled"
								class="w-full"
							/>
						</div>
					</UFormField>

					<UFormField
						label="Background"
						size="sm"
						help="Blank = transparent. Add an alpha (#rrggbbaa) for partial transparency."
					>
						<div class="flex items-center gap-2">
							<input
								:value="swatch(form.background, '#ffffff')"
								type="color"
								:disabled="disabled"
								class="h-9 w-12 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
								@input="(e) => onColorInput('background', e)"
							/>
							<UInput
								v-model="form.background"
								placeholder="Transparent"
								:disabled="disabled"
								class="w-full"
							/>
							<UButton
								v-if="form.background"
								color="neutral"
								variant="ghost"
								icon="mdi:close"
								size="xs"
								aria-label="Clear Background"
								:disabled="disabled"
								@click="
									() => {
										form.background = '';
									}
								"
							/>
						</div>
					</UFormField>
				</div>

				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<UFormField
						label="Stroke Color"
						size="sm"
						help="Blank = no stroke. Alpha (#rrggbbaa) supported."
					>
						<div class="flex items-center gap-2">
							<input
								:value="swatch(form.stroke_color, '#000000')"
								type="color"
								:disabled="disabled"
								class="h-9 w-12 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
								@input="(e) => onColorInput('stroke_color', e)"
							/>
							<UInput
								v-model="form.stroke_color"
								placeholder="None"
								:disabled="disabled"
								class="w-full"
							/>
							<UButton
								v-if="form.stroke_color"
								color="neutral"
								variant="ghost"
								icon="mdi:close"
								size="xs"
								aria-label="Clear Stroke"
								:disabled="disabled"
								@click="
									() => {
										form.stroke_color = '';
									}
								"
							/>
						</div>
					</UFormField>

					<UFormField
						label="Stroke Width"
						size="sm"
					>
						<UInput
							v-model.number="form.stroke_width"
							type="number"
							min="0"
							step="0.5"
							:disabled="disabled"
							class="w-full"
						/>
					</UFormField>
				</div>

				<UFormField
					label="Title"
					size="sm"
					help="The company name embedded in the SVG (BIMI requires it)."
				>
					<UInput
						v-model="form.title"
						:placeholder="settings?.name || 'Logo'"
						:disabled="disabled"
						class="w-full"
					/>
				</UFormField>
			</div>
		</div>

		<div class="flex items-center justify-end gap-3">
			<span
				v-if="!loaded"
				class="text-xs text-slate-500"
				>Loading current settings...</span
			>
			<UButton
				color="primary"
				icon="mdi:content-save-outline"
				:loading="saving"
				:disabled="disabled || !loaded"
				@click="onSave"
				>Save Logo</UButton
			>
		</div>
	</div>
</template>

<script setup lang="ts">
type BimiStatus = { configured: boolean; record: string | null };

const toast = useToast();
const { sessionToken } = useAuth();
const { settings, loaded, save, fetchSettings } = useSettings();

const saving = ref(false);
const checkingStatus = ref(true);
const bimiStatus = ref<BimiStatus | null>(null);
const requestFetch = useRequestFetch();

// the logo customizer is gated on the DNS record existing (mirrors email-channel depends on cloudflare)
const provisioned = computed(() => !!bimiStatus.value?.record);
const disabled = computed(() => !loaded.value || !provisioned.value);

const form = reactive({
	enabled: false,
	icon: '',
	fill: '#000000',
	background: '',
	stroke_color: '',
	stroke_width: 0,
	title: ''
});

// native <input type="color"> only reflects the swatch; mirror it into the form field
function onColorInput(field: 'background' | 'stroke_color', event: Event) {
	form[field] = (event.target as HTMLInputElement).value;
}

// the native color input only understands 6-digit hex; strip any alpha for the swatch display
function swatch(value: string, fallback: string): string {
	return /^#[0-9a-f]{6,8}$/i.test(value) ? value.slice(0, 7) : fallback;
}

watch(
	settings,
	(value) => {
		if (!value) return;
		const bimi = (value.bimi as Record<string, any>) || {};
		form.enabled = bimi.enabled === true;
		form.icon = bimi.icon || value.favicon || '';
		form.fill = bimi.fill || (value.themeColor as string) || '#000000';
		form.background = bimi.background || '';
		form.stroke_color = bimi.stroke_color || '';
		form.stroke_width = typeof bimi.stroke_width === 'number' ? bimi.stroke_width : 0;
		form.title = bimi.title || '';
	},
	{ immediate: true }
);

// the /bimi/logo.svg route accepts these overrides; a distinct query = a distinct url so the browser
// refetches as the fields change (no manual cache-bust needed)
const previewUrl = computed(() => {
	const p = new URLSearchParams();
	if (form.icon) p.set('icon', form.icon);
	p.set('fill', form.fill || '#000000');
	p.set('bg', form.background);
	p.set('stroke', form.stroke_color);
	if (form.stroke_width) p.set('stroke_width', String(form.stroke_width));
	p.set('title', form.title || settings.value?.name || 'Logo');
	return `/bimi/logo.svg?${p.toString()}`;
});

async function loadStatus() {
	checkingStatus.value = true;
	try {
		bimiStatus.value = await requestFetch<BimiStatus>('/api/cloudflare/bimi-status', {
			cache: 'no-store',
			credentials: 'include',
			headers: sessionToken.value ? { Authorization: `Bearer ${sessionToken.value}` } : {}
		});
	} catch {
		bimiStatus.value = null;
	} finally {
		checkingStatus.value = false;
	}
}
onMounted(loadStatus);

async function onSave() {
	saving.value = true;
	try {
		await save({
			bimi: {
				enabled: form.enabled,
				icon: form.icon.trim(),
				fill: form.fill.trim(),
				background: form.background.trim(),
				stroke_color: form.stroke_color.trim(),
				stroke_width: form.stroke_width || 0,
				title: form.title.trim()
			}
		});
		await fetchSettings(true);
		toast.add({
			title: 'Logo Saved',
			description: 'Your BIMI logo was updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Save Logo',
			description: extractServerMessage(error, 'Could not save the logo. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
