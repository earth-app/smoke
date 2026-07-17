<template>
	<div class="flex flex-col gap-6">
		<section
			class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
		>
			<h3 class="text-sm font-semibold">Branding</h3>
			<UFormField
				label="Name"
				help="Displayed in the sidebar, navbar, and emails."
			>
				<UInput
					v-model="form.name"
					class="w-full"
				/>
			</UFormField>
			<UFormField label="Description">
				<UTextarea
					v-model="form.description"
					:rows="2"
					class="w-full"
				/>
			</UFormField>
			<UFormField label="Theme Color">
				<div class="flex items-center gap-3">
					<input
						v-model="form.themeColor"
						type="color"
						class="h-9 w-14 cursor-pointer rounded border border-slate-200 dark:border-slate-700"
					/>
					<UInput
						v-model="form.themeColor"
						placeholder="#3b82f6"
						class="w-40"
					/>
				</div>
			</UFormField>

			<UFormField
				label="Favicon"
				help="An Iconify icon (e.g. mdi:rocket-launch), an image URL/path, or an uploaded file."
			>
				<div class="flex flex-col gap-2">
					<div class="flex items-center gap-3">
						<span
							class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
						>
							<img
								v-if="isImage(form.favicon)"
								:src="form.favicon"
								alt="Favicon preview"
								class="size-full object-contain"
							/>
							<UIcon
								v-else-if="form.favicon"
								:name="form.favicon"
								class="size-5"
							/>
							<UIcon
								v-else
								name="mdi:image-outline"
								class="size-5 text-slate-400"
							/>
						</span>
						<UInput
							v-model="form.favicon"
							placeholder="mdi:rocket-launch"
							class="w-full"
						/>
					</div>
					<div class="flex items-center gap-2">
						<UFileUpload
							v-model="faviconFile"
							accept=".ico,.svg,image/x-icon,image/png,image/svg+xml"
							class="w-full"
						/>
						<UButton
							v-if="form.favicon"
							color="neutral"
							variant="ghost"
							icon="mdi:close"
							size="xs"
							aria-label="Clear Favicon"
							@click="clearFavicon"
						/>
					</div>
				</div>
			</UFormField>

			<UFormField
				label="Favicon Image (PNG)"
				help="Optional PNG for browsers that don't render an SVG or icon favicon."
			>
				<div class="flex flex-col gap-2">
					<div class="flex items-center gap-3">
						<span
							class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
						>
							<img
								v-if="isImage(form.faviconPng)"
								:src="form.faviconPng"
								alt="PNG favicon preview"
								class="size-full object-contain"
							/>
							<UIcon
								v-else
								name="mdi:image-outline"
								class="size-5 text-slate-400"
							/>
						</span>
						<UInput
							v-model="form.faviconPng"
							placeholder="https://..."
							class="w-full"
						/>
					</div>
					<div class="flex items-center gap-2">
						<UFileUpload
							v-model="faviconPngFile"
							accept="image/png"
							class="w-full"
						/>
						<UButton
							v-if="form.faviconPng"
							color="neutral"
							variant="ghost"
							icon="mdi:close"
							size="xs"
							aria-label="Clear PNG Favicon"
							@click="clearFaviconPng"
						/>
					</div>
				</div>
			</UFormField>
		</section>

		<section
			class="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
		>
			<h3 class="text-sm font-semibold">Social Links</h3>
			<p class="-mt-2 text-xs text-slate-500">Shown in the site footer. Leave blank to hide.</p>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<UFormField
					v-for="field in socialFields"
					:key="field.key"
					:label="field.label"
				>
					<UInput
						v-model="form[field.key]"
						:icon="field.icon"
						:placeholder="field.placeholder"
						class="w-full"
					/>
				</UFormField>
			</div>
		</section>

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
				:disabled="!loaded"
				@click="onSave"
			>
				Save Branding
			</UButton>
		</div>
	</div>
</template>

<script setup lang="ts">
const toast = useToast();
const { settings, loaded, save } = useSettings();

type SocialKey =
	'website' | 'github' | 'twitter' | 'instagram' | 'discord' | 'linkedin' | 'patreon';
type BrandingKey = 'name' | 'description' | 'themeColor' | 'favicon' | 'faviconPng' | SocialKey;

const form = reactive<Record<BrandingKey, string>>({
	name: '',
	description: '',
	themeColor: '#3b82f6',
	favicon: '',
	faviconPng: '',
	website: '',
	github: '',
	twitter: '',
	instagram: '',
	discord: '',
	linkedin: '',
	patreon: ''
});

const socialFields: { key: SocialKey; label: string; icon: string; placeholder: string }[] = [
	{ key: 'website', label: 'Website', icon: 'mdi:web', placeholder: 'https://example.com' },
	{
		key: 'github',
		label: 'GitHub',
		icon: 'mdi:github',
		placeholder: 'org or https://github.com/org'
	},
	{ key: 'twitter', label: 'Twitter / X', icon: 'mdi:twitter', placeholder: '@handle' },
	{ key: 'instagram', label: 'Instagram', icon: 'mdi:instagram', placeholder: '@handle' },
	{ key: 'discord', label: 'Discord', icon: 'mdi:discord', placeholder: 'https://discord.gg/...' },
	{ key: 'linkedin', label: 'LinkedIn', icon: 'mdi:linkedin', placeholder: 'company/name' },
	{ key: 'patreon', label: 'Patreon', icon: 'mdi:patreon', placeholder: 'name' }
];

const faviconFile = ref<File | null>(null);
const faviconPngFile = ref<File | null>(null);
const saving = ref(false);

function isImage(value: string): boolean {
	return /^(data:image\/|https?:\/\/|\/)/.test(value) && !/^\/?[a-z0-9-]+:[a-z0-9-]+$/i.test(value);
}

// favicon upload -> data url (nuxtpress/mylora convention): a chosen file is read into a data url
// and stored as the setting, so no separate asset host is needed; the text field stays for a url/id
function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

watch(faviconFile, async (file) => {
	if (file) form.favicon = await readAsDataUrl(file);
});
watch(faviconPngFile, async (file) => {
	if (file) form.faviconPng = await readAsDataUrl(file);
});

function clearFavicon() {
	form.favicon = '';
	faviconFile.value = null;
}
function clearFaviconPng() {
	form.faviconPng = '';
	faviconPngFile.value = null;
}

watch(
	settings,
	(value) => {
		if (!value) return;
		for (const key of Object.keys(form) as BrandingKey[]) {
			form[key] = (value[key] as string) || (key === 'themeColor' ? '#3b82f6' : '');
		}
	},
	{ immediate: true }
);

async function onSave() {
	saving.value = true;
	try {
		await save({ ...form });
		toast.add({
			title: 'Branding Saved',
			description: 'Your branding and social links were updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Save Branding',
			description: extractServerMessage(error, 'Could not save branding. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
