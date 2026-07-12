<template>
	<div class="flex min-h-screen bg-slate-50 dark:bg-slate-950">
		<Sidebar
			v-model:collapsed="collapsed"
			class="shrink-0"
		/>
		<div class="flex min-w-0 flex-1 flex-col">
			<header
				class="flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900"
			>
				<UButton
					color="neutral"
					variant="ghost"
					:icon="collapsed ? 'mdi:menu' : 'mdi:backburger'"
					:aria-label="collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'"
					@click="
						() => {
							collapsed = !collapsed;
						}
					"
				/>
				<div class="ml-auto flex items-center gap-3">
					<UDropdownMenu
						:items="menuItems"
						:content="{ align: 'end' }"
					>
						<UButton
							color="neutral"
							variant="ghost"
							class="gap-2"
						>
							<Avatar
								:avatar="user?.avatar_url"
								:id="user?.id"
								:name="user?.username"
								:role="user?.role"
								size="sm"
							/>
							<span class="hidden text-sm font-medium sm:inline">{{
								user?.name || user?.username
							}}</span>
						</UButton>
					</UDropdownMenu>
				</div>
			</header>
			<main
				id="main-content"
				tabindex="-1"
				class="min-w-0 flex-1 p-4 focus:outline-none sm:p-6"
			>
				<PageContextMenu>
					<slot />
				</PageContextMenu>
			</main>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';

const { user, logout } = useAuth();
const toast = useToast();
const router = useRouter();

const collapsed = ref(false);

async function logoutUser() {
	const result = await logout();
	if (!result.success) {
		toast.add({
			title: 'Logout Failed',
			description: result.message || 'Unable to log out right now. Please try again.',
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
		return;
	}

	toast.add({
		title: 'Logged Out',
		description: 'You have successfully logged out.',
		icon: 'mdi:logout',
		color: 'success',
		duration: 3000
	});

	await router.push('/login');
}

const menuItems = computed<DropdownMenuItem[][]>(() => [
	[
		{
			label: 'Profile',
			icon: 'mdi:account-circle-outline',
			to: '/dashboard/profile'
		},
		{
			label: 'Settings',
			icon: 'mdi:cog-outline',
			to: '/dashboard/settings'
		}
	],
	[
		{
			label: 'Log Out',
			icon: 'mdi:logout',
			color: 'error',
			onSelect: () => logoutUser()
		}
	]
]);
</script>
