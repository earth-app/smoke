import { useAuthStore } from '~/stores/auth';

export function useAuth() {
	const authStore = useAuthStore();

	const sessionToken = computed(() => authStore.sessionToken);
	const user = computed(() => authStore.currentUser);

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
	// the founding owner is a locked admin; server-flagged on the current-user payload
	const isOwner = computed(() => !!user.value?.is_owner);

	const fetchUser = async (force: boolean = false) => {
		try {
			await authStore.fetchCurrentUser(force);
		} catch (error) {
			console.error('Failed to fetch current user:', error);
		}
	};

	const updateUser = async (user: Partial<User>) => {
		try {
			await authStore.updateUser(user);
			return { success: true, message: 'User updated successfully' };
		} catch (error) {
			return {
				success: false,
				message: extractServerMessage(error, 'Could not update your account.')
			};
		}
	};

	const login = async (usernameOrEmail: string, password: string) => {
		try {
			await authStore.login(usernameOrEmail, password);
			return { success: true, message: 'Login successful' };
		} catch (error) {
			return {
				success: false,
				message: extractServerMessage(error, 'Invalid username or password.')
			};
		}
	};

	const logout = async () => {
		try {
			await authStore.logout();
			return { success: true, message: 'Logout successful' };
		} catch (error) {
			return { success: false, message: extractServerMessage(error, 'Could not sign you out.') };
		}
	};

	const setSessionToken = (token: string | null) => {
		authStore.setSessionToken(token);
	};

	const can = (permission: Permission): boolean => !!user.value?.permissions?.includes(permission);

	// load user state
	fetchUser();

	return {
		sessionToken,
		user,
		isAuthenticated,
		isAdmin,
		isManager,
		isAgent,
		isOwner,
		can,
		fetchUser,
		updateUser,
		login,
		logout,
		setSessionToken
	};
}
