<template>
	<div class="mx-auto flex max-w-4xl flex-col gap-5">
		<div>
			<h1 class="text-2xl font-semibold">Users</h1>
			<p class="text-sm text-slate-500">Manage your support team and their permissions.</p>
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
	</div>
</template>

<script setup lang="ts">
import type { User } from '~/shared/types/user';
import { useUserStore } from '~/stores/user';

definePageMeta({ layout: 'dashboard', middleware: 'admin' });

const userStore = useUserStore();

const search = ref('');
const users = ref<User[]>([]);
const pending = ref(true);

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
</script>
