import type { CustomFieldDef } from '~/shared/types/ticket';
import { useCustomFieldsStore } from '~/stores/customFields';

export function useCustomFields() {
	const store = useCustomFieldsStore();

	const fields = computed<CustomFieldDef[]>(() => store.fields);
	const pending = ref(false);

	const fetchFields = async (force: boolean = false): Promise<CustomFieldDef[]> => {
		pending.value = true;
		try {
			return await store.fetch(force);
		} finally {
			pending.value = false;
		}
	};

	const saveFields = async (defs: CustomFieldDef[]) => await store.save(defs);

	// load once on first use
	fetchFields();

	return { fields, pending, fetchFields, saveFields };
}
