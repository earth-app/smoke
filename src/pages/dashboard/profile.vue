<template>
	<div class="mx-auto flex max-w-3xl flex-col gap-5">
		<div>
			<h1 class="text-2xl font-semibold">Your Profile</h1>
			<p class="text-sm text-slate-500">Manage your account details and linked mailboxes.</p>
		</div>

		<div
			v-if="!user"
			class="space-y-3"
		>
			<USkeleton class="h-32 w-full rounded-lg" />
			<USkeleton class="h-40 w-full rounded-lg" />
		</div>

		<template v-else>
			<div
				class="flex flex-col gap-5 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
			>
				<div class="flex items-center gap-4">
					<UAvatar
						:src="user.avatar_url"
						:alt="user.username"
						size="xl"
					/>
					<div class="flex flex-col gap-2">
						<UButton
							color="neutral"
							variant="soft"
							icon="mdi:camera-outline"
							size="sm"
							:loading="uploading"
							@click="pickAvatar"
							>Change Avatar</UButton
						>
						<input
							ref="avatarInput"
							type="file"
							accept="image/*"
							class="hidden"
							@change="onAvatarChosen"
						/>
						<p class="text-xs text-slate-400">PNG or JPG, up to a few MB.</p>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<UFormField label="Name">
						<UInput
							v-model="form.name"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Username">
						<UInput
							v-model="form.username"
							class="w-full"
						/>
					</UFormField>
				</div>
				<UFormField
					label="Email"
					help="Changing your email updates your sign-in address."
				>
					<UInput
						v-model="form.email"
						type="email"
						class="w-full"
					/>
				</UFormField>

				<div class="flex justify-end">
					<UButton
						color="primary"
						icon="mdi:content-save-outline"
						:loading="saving"
						@click="saveProfile"
						>Save Profile</UButton
					>
				</div>
			</div>

			<LinkedMailboxes :user-id="user.id" />
		</template>
	</div>
</template>

<script setup lang="ts">
import { useUserStore } from '~/stores/user';

definePageMeta({ layout: 'dashboard', middleware: 'staff' });

const toast = useToast();
const { user, updateUser, fetchUser } = useAuth();
const userStore = useUserStore();

const form = reactive({ name: '', username: '', email: '' });
const saving = ref(false);
const uploading = ref(false);
const avatarInput = ref<HTMLInputElement | null>(null);

watch(
	user,
	(value) => {
		if (value) {
			form.name = value.name || '';
			form.username = value.username || '';
			form.email = value.email || '';
		}
	},
	{ immediate: true }
);

function pickAvatar() {
	avatarInput.value?.click();
}

async function onAvatarChosen(event: Event) {
	const target = event.target as HTMLInputElement;
	const file = target.files?.[0];
	target.value = '';
	if (!file || !user.value) return;
	uploading.value = true;
	try {
		await userStore.setAvatar(user.value.id, file);
		await fetchUser(true);
		toast.add({
			title: 'Avatar Updated',
			description: 'Your new avatar was saved.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch {
		toast.add({
			title: 'Failed to Update Avatar',
			description: 'Could not upload your avatar. Please try again.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		uploading.value = false;
	}
}

async function saveProfile() {
	saving.value = true;
	try {
		const result = await updateUser({
			name: form.name,
			username: form.username,
			email: form.email
		});
		if (!result.success) throw new Error(result.message);
		toast.add({
			title: 'Profile Saved',
			description: 'Your profile was updated.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch {
		toast.add({
			title: 'Failed to Save Profile',
			description: 'Could not save your profile. Please try again.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
