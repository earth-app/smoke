<template>
	<div class="flex flex-col gap-4">
		<div class="flex items-center gap-4">
			<Avatar
				:avatar="previewAvatar"
				:icon="previewIcon"
				:id="userId"
				:name="name"
				size="xl"
			/>
			<div class="min-w-0 text-sm">
				<p class="font-medium text-slate-700 dark:text-slate-200">Avatar</p>
				<p class="text-slate-500">Upload an image, pick an icon, or paste an image URL.</p>
			</div>
		</div>

		<UTabs
			v-model="mode"
			:items="modeItems"
		>
			<template #upload>
				<div class="mt-4">
					<UFileUpload
						v-model="file"
						accept="image/*"
						class="w-full"
					/>
				</div>
			</template>

			<template #icon>
				<div class="mt-4 flex flex-col gap-3">
					<UInput
						v-model="iconName"
						placeholder="mdi:robot"
						class="w-full"
					>
						<template #leading>
							<UIcon
								:name="iconName || 'mdi:image-outline'"
								:class="iconName ? 'text-default' : 'text-dimmed'"
							/>
						</template>
					</UInput>
					<div class="flex flex-wrap gap-2">
						<UButton
							v-for="suggestion in suggestedIcons"
							:key="suggestion"
							:icon="suggestion"
							:color="iconName === suggestion ? 'primary' : 'neutral'"
							:variant="iconName === suggestion ? 'soft' : 'ghost'"
							size="sm"
							:aria-label="suggestion"
							@click="
								() => {
									iconName = suggestion;
								}
							"
						/>
					</div>
				</div>
			</template>

			<template #url>
				<div class="mt-4">
					<UInput
						v-model="urlValue"
						type="url"
						placeholder="https://..."
						class="w-full"
					/>
				</div>
			</template>
		</UTabs>

		<div class="flex justify-end">
			<UButton
				color="primary"
				icon="mdi:content-save-outline"
				:loading="applying"
				:disabled="!canApply"
				@click="apply"
				>Apply Avatar</UButton
			>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui';
import type { User } from '~/shared/types/user';

const props = defineProps<{ userId: string; currentAvatar?: string | null; name?: string }>();
const emit = defineEmits<{ updated: [user: User] }>();

const toast = useToast();
const userStore = useUserStore();

const suggestedIcons = [
	'mdi:account',
	'mdi:robot',
	'mdi:face-man',
	'mdi:face-woman',
	'mdi:emoticon-happy-outline',
	'mdi:shield-account'
];

const modeItems: TabsItem[] = [
	{ label: 'Upload', slot: 'upload', value: 'upload', icon: 'mdi:tray-arrow-up' },
	{ label: 'Icon', slot: 'icon', value: 'icon', icon: 'mdi:emoticon-outline' },
	{ label: 'URL', slot: 'url', value: 'url', icon: 'mdi:link-variant' }
];

// seed the initial mode + fields from the existing avatar value
const seedIcon = props.currentAvatar?.startsWith('icon:') ? props.currentAvatar.slice(5) : '';
const seedUrl = /^https?:\/\//i.test(props.currentAvatar || '') ? props.currentAvatar! : '';

const mode = ref(seedIcon ? 'icon' : seedUrl ? 'url' : 'upload');
const iconName = ref(seedIcon);
const urlValue = ref(seedUrl);
const file = ref<File | null>(null);
const filePreview = ref('');
const applying = ref(false);

function readAsDataUrl(f: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(f);
	});
}

watch(file, async (f) => {
	filePreview.value = f ? await readAsDataUrl(f) : '';
});

const previewIcon = computed(() =>
	mode.value === 'icon' ? iconName.value || undefined : undefined
);

const previewAvatar = computed(() => {
	if (mode.value === 'upload') return filePreview.value || props.currentAvatar || undefined;
	if (mode.value === 'url') return urlValue.value || undefined;
	return undefined;
});

const canApply = computed(() => {
	if (mode.value === 'upload') return !!file.value;
	if (mode.value === 'icon') return !!iconName.value.trim();
	return !!urlValue.value.trim();
});

async function apply() {
	if (!canApply.value || applying.value) return;
	applying.value = true;
	try {
		let updated: User;
		if (mode.value === 'upload' && file.value) {
			updated = await userStore.setAvatar(props.userId, file.value);
		} else if (mode.value === 'icon') {
			updated = await userStore.setAvatar(props.userId, { icon: iconName.value.trim() });
		} else {
			updated = await userStore.setAvatar(props.userId, urlValue.value.trim());
		}

		emit('updated', updated);
		toast.add({
			title: 'Avatar Updated',
			description: 'Your avatar was changed.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Update Avatar',
			description: extractServerMessage(error, 'Could not change the avatar. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		applying.value = false;
	}
}
</script>
