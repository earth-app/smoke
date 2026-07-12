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
					<Avatar
						:avatar="user.avatar_url"
						:id="user.id"
						:name="displayName(user)"
						size="xl"
					/>
					<div class="min-w-0">
						<p class="truncate font-medium">{{ displayName(user) }}</p>
						<UserAvatarPicker
							:user-id="user.id"
							:current-avatar="user.avatar_url"
							:name="displayName(user)"
							@updated="onAvatarUpdated"
						/>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<UFormField
						label="First Name"
						help="Shown across the dashboard in place of your username."
					>
						<UInput
							v-model="form.first_name"
							class="w-full"
						/>
					</UFormField>
					<UFormField label="Last Name">
						<UInput
							v-model="form.last_name"
							class="w-full"
						/>
					</UFormField>
				</div>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<UFormField label="Display Name">
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

			<UserLinkedMailboxes :user-id="user.id" />
		</template>
	</div>
</template>

<script setup lang="ts">
useSeoMeta({ title: 'Profile' });
definePageMeta({ layout: 'dashboard', middleware: 'staff' });

const toast = useToast();
const { user, updateUser, fetchUser } = useAuth();

const form = reactive({ first_name: '', last_name: '', name: '', username: '', email: '' });
const saving = ref(false);

watch(
	user,
	(value) => {
		if (value) {
			form.first_name = value.first_name || '';
			form.last_name = value.last_name || '';
			form.name = value.name || '';
			form.username = value.username || '';
			form.email = value.email || '';
		}
	},
	{ immediate: true }
);

async function onAvatarUpdated() {
	// setAvatar updates the user store cache but not useAuth().user; refresh it
	await fetchUser(true);
	toast.add({
		title: 'Avatar Updated',
		description: 'Your new avatar was saved.',
		icon: 'mdi:check',
		color: 'success',
		duration: 3000
	});
}

async function saveProfile() {
	// a last name requires a first name (mirrors the server refine)
	if (form.last_name.trim() && !form.first_name.trim()) {
		toast.add({
			title: 'First Name Required',
			description: 'Enter a first name before adding a last name.',
			icon: 'mdi:alert-circle',
			color: 'warning',
			duration: 4000
		});
		return;
	}
	saving.value = true;
	try {
		const result = await updateUser({
			first_name: form.first_name.trim() || undefined,
			last_name: form.last_name.trim() || undefined,
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
	} catch (error) {
		toast.add({
			title: 'Failed to Save Profile',
			description: extractServerMessage(error, 'Could not save your profile. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}
</script>
