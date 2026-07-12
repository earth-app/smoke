<template>
	<div class="mx-auto flex max-w-4xl flex-col gap-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 class="text-2xl font-semibold">Users</h1>
				<p class="text-sm text-slate-500">Manage your support team and their permissions.</p>
			</div>
			<UButton
				v-if="canInvite"
				color="primary"
				icon="mdi:account-plus"
				@click="
					() => {
						inviteOpen = true;
					}
				"
			>
				Invite Agent
			</UButton>
		</div>

		<UInput
			v-model="search"
			icon="mdi:magnify"
			placeholder="Search users"
			class="max-w-md"
		/>

		<UserTable
			:users="users"
			:pending="pending"
		/>

		<UserInviteAgent v-model:open="inviteOpen" />
	</div>
</template>

<script setup lang="ts">
useSeoMeta({ title: 'Users' });
import type { ContextMenuItem } from '@nuxt/ui';
import { Permission, type User } from '~/shared/types/user';
import { useUserStore } from '~/stores/user';

definePageMeta({ layout: 'dashboard', middleware: 'admin' });

const userStore = useUserStore();
const { can } = useAuth();

const search = ref('');
const users = ref<User[]>([]);
const pending = ref(true);
const inviteOpen = ref(false);

const canInvite = computed(() => can(Permission.ManageUsers));

async function load() {
	pending.value = true;
	try {
		const params = search.value.trim()
			? { search: search.value.trim(), limit: 100 }
			: { limit: 100 };
		users.value = await userStore.listUsers(params);
	} finally {
		pending.value = false;
	}
}

let timer: ReturnType<typeof setTimeout> | null = null;
watch(search, () => {
	if (timer) clearTimeout(timer);
	timer = setTimeout(load, 300);
});

onMounted(load);

setPageMenu(() => {
	const actions: ContextMenuItem[] = [];
	if (canInvite.value)
		actions.push({
			label: 'Invite Agent',
			icon: 'mdi:account-plus',
			onSelect: () => {
				inviteOpen.value = true;
			}
		});
	actions.push({ label: 'Refresh Users', icon: 'mdi:refresh', onSelect: load });
	return [actions];
});
</script>
