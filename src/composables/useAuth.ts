import { useAuthStore } from '~/stores/auth';

export function useAuth() {
	const authStore = useAuthStore();

	const sessionToken = computed(() => authStore.sessionToken);
	const user = computed(() => authStore.currentUser);
	const fetchUser = async (force: boolean = false) => {
		try {
			await authStore.fetchCurrentUser(force);
		} catch (error) {
			console.error('Failed to fetch current user:', error);
		}
	};
	const isAuthenticated = computed(() => authStore.isAuthenticated);
	const isAdmin = computed(() => authStore.isAdmin);

	const isManager = computed(
		() => user.value?.role === Role.Manager || user.value?.role === Role.Admin
	);
	const isAgent = computed(
		() =>
			user.value?.role === Role.Agent ||
			user.value?.role === Role.Manager ||
			user.value?.role === Role.Admin
	);

	const login = async (usernameOrEmail: string, password: string) => {
		try {
			await authStore.login(usernameOrEmail, password);
			return { success: true, message: 'Login successful' };
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : 'An unknown error occurred'
			};
		}
	};

	const logout = async () => {
		try {
			await authStore.logout();
			return { success: true, message: 'Logout successful' };
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : 'An unknown error occurred'
			};
		}
	};

	return {
		sessionToken,
		user,
		fetchUser,
		login,
		logout,
		isAuthenticated,
		isAdmin,
		isManager,
		isAgent
	};
}
