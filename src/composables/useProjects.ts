import type { Project } from '~/shared/types/ticket';
import { useProjectsStore, type ProjectInput } from '~/stores/projects';

export function useProjects() {
	const projectsStore = useProjectsStore();

	const projects = computed<Project[]>(() => projectsStore.list);
	const pending = ref(false);

	const listProjects = async (): Promise<Project[]> => {
		pending.value = true;
		try {
			return await projectsStore.listProjects();
		} finally {
			pending.value = false;
		}
	};

	const getProject = (id: number): Project | undefined => projectsStore.get(id);

	const createProject = async (body: ProjectInput) => await projectsStore.createProject(body);

	const updateProject = async (id: number, body: Partial<ProjectInput>) =>
		await projectsStore.updateProject(id, body);

	const deleteProject = async (id: number) => await projectsStore.deleteProject(id);

	// load once on first use; the store dedupes concurrent list calls
	listProjects();

	return {
		projects,
		pending,
		listProjects,
		getProject,
		createProject,
		updateProject,
		deleteProject
	};
}
