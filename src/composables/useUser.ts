// #region users

export function useUser(identifier: MaybeRefOrGetter<string>) {
	const userStore = useUserStore();
	const currentId = computed(() => toValue(identifier));

	const user = computed(() => userStore.get(currentId.value));
	const fetchUser = async (force: boolean = false) => {
		if (user.value && !force) {
			return user.value;
		}

		try {
			return await userStore.fetchUser(currentId.value, force);
		} catch (error) {
			console.error('Failed to fetch user:', error);
			return null;
		}
	};

	const updateUser = async (userData: Partial<User>) => {
		if (!id.value) {
			console.warn('Cannot update user: no user ID available');
			return user.value;
		}

		try {
			return await userStore.updateUser({ ...userData, id: id.value });
		} catch (error) {
			console.error('Failed to update user:', error);
			return user.value;
		}
	};

	const id = computed(() => user.value?.id);
	const username = computed(() => user.value?.username);
	const setUsername = async (username: string) => {
		return await updateUser({ username });
	};

	const name = computed(() => user.value?.name);
	const setName = async (name: string) => {
		return await updateUser({ name });
	};

	const email = computed(() => user.value?.email);
	const setEmail = async (email: string) => {
		return await updateUser({ email });
	};

	const avatar = computed(() => userStore.avatars.get(currentId.value) || null);
	const setAvatar = async (avatar: File | Blob | ArrayBuffer | string) => {
		if (!id.value) {
			console.warn('Cannot set avatar: no user ID available');
			return user.value;
		}

		try {
			await userStore.setAvatar(id.value, avatar);
			return await fetchUser(true); // refetch to get updated avatar_url
		} catch (error) {
			console.error('Failed to set avatar:', error);
			return user.value;
		}
	};

	const permissions = computed(() => user.value?.permissions || []);
	const setPermissions = async (permissions: Permission[]) => {
		if (!user.value) {
			console.warn('Cannot set permissions: no user loaded');
			return user.value;
		}

		return await updateUser({ permissions });
	};
	const addPermissions = async (permissions: Permission[]) => {
		if (!user.value) {
			console.warn('Cannot add permissions: no user loaded');
			return user.value;
		}

		const newPermissions = Array.from(new Set([...(user.value.permissions || []), ...permissions]));
		return await updateUser({ permissions: newPermissions });
	};

	const removePermissions = async (permissions: Permission[]) => {
		if (!user.value) {
			console.warn('Cannot remove permissions: no user loaded');
			return user.value;
		}

		const newPermissions = (user.value.permissions || []).filter((p) => !permissions.includes(p));
		return await updateUser({ permissions: newPermissions });
	};

	const role = computed(() => user.value?.role);
	const setRole = async (role: Role) => {
		if (!user.value) {
			console.warn('Cannot set role: no user loaded');
			return user.value;
		}

		return await updateUser({ role });
	};

	const labels = computed(() => user.value?.labels || []);
	const setLabels = async (labels: Label[]) => {
		if (!user.value) {
			console.warn('Cannot set labels: no user loaded');
			return user.value;
		}

		return await updateUser({ labels });
	};
	const addLabels = async (labels: Label[]) => {
		if (!user.value) {
			console.warn('Cannot add labels: no user loaded');
			return user.value;
		}

		const newLabels = Array.from(new Set([...(user.value.labels || []), ...labels]));
		return await updateUser({ labels: newLabels });
	};
	const removeLabels = async (labels: Label[]) => {
		if (!user.value) {
			console.warn('Cannot remove labels: no user loaded');
			return user.value;
		}

		const newLabels = (user.value.labels || []).filter((l) => !labels.some((rl) => rl.id === l.id));
		return await updateUser({ labels: newLabels });
	};

	// load user state
	fetchUser();
	watch(currentId, (newId, oldId) => {
		if (newId !== oldId) {
			fetchUser();
		}
	});

	return {
		user,
		fetchUser,
		updateUser,
		username,
		setUsername,
		name,
		setName,
		email,
		setEmail,
		avatar,
		setAvatar,
		permissions,
		setPermissions,
		addPermissions,
		removePermissions,
		role,
		setRole,
		labels,
		setLabels,
		addLabels,
		removeLabels
	};
}

// #endregion

// #region customers

export function useCustomers(options?: MaybeRefOrGetter<QueryParameters | undefined>) {
	const customersStore = useCustomerStore();

	const customers = ref<Customer[]>([]);
	const pending = ref(false);

	const listCustomers = async (override?: QueryParameters): Promise<Customer[]> => {
		pending.value = true;
		try {
			const query = override ?? toValue(options);
			const result = await customersStore.listCustomers(query);
			customers.value = result;
			return result;
		} finally {
			pending.value = false;
		}
	};

	const fetchCustomer = async (id: number, force: boolean = false) => {
		return await customersStore.fetchCustomer(id, force);
	};

	const createCustomer = async (body: Partial<Customer>) => {
		return await customersStore.createCustomer(body);
	};

	const patchCustomer = async (id: number, body: Partial<Customer>) => {
		return await customersStore.patchCustomer(id, body);
	};

	const deleteCustomer = async (id: number) => {
		await customersStore.deleteCustomer(id);
		customers.value = customers.value.filter((c) => c.id !== id);
	};

	if (options !== undefined) {
		listCustomers();
		watch(
			() => toValue(options),
			() => listCustomers(),
			{ deep: true }
		);
	}

	return {
		customers,
		pending,
		listCustomers,
		fetchCustomer,
		createCustomer,
		patchCustomer,
		deleteCustomer
	};
}

// #endregion
