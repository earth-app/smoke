import type { Label } from '~/shared/types/user';
import { useLabelsStore } from '~/stores/labels';

export function useLabels(options?: MaybeRefOrGetter<QueryParameters | undefined>) {
	const labelsStore = useLabelsStore();

	const labels = ref<Label[]>([]);
	const pending = ref(false);

	const listLabels = async (override?: QueryParameters): Promise<Label[]> => {
		pending.value = true;
		try {
			const query = override ?? toValue(options);
			const result = await labelsStore.listLabels(query);
			labels.value = result;
			return result;
		} finally {
			pending.value = false;
		}
	};

	const fetchLabel = async (id: number, force: boolean = false) => {
		return await labelsStore.fetchLabel(id, force);
	};

	const createLabel = async (body: Partial<Label>) => {
		const label = await labelsStore.createLabel(body);
		labels.value = [...labels.value, label];
		return label;
	};

	const patchLabel = async (id: number, body: Partial<Label>) => {
		const label = await labelsStore.patchLabel(id, body);
		labels.value = labels.value.map((l) => (l.id === id ? label : l));
		return label;
	};

	const deleteLabel = async (id: number) => {
		await labelsStore.deleteLabel(id);
		labels.value = labels.value.filter((l) => l.id !== id);
	};

	if (options !== undefined) {
		listLabels();
		watch(
			() => toValue(options),
			() => listLabels(),
			{ deep: true }
		);
	}

	return {
		labels,
		pending,
		listLabels,
		fetchLabel,
		createLabel,
		patchLabel,
		deleteLabel
	};
}
