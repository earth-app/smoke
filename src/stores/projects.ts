import { defineStore } from 'pinia';
import type { Project } from '~/shared/types/ticket';
import { useAuthStore } from '~/stores/auth';

export type ProjectInput = { name: string; description?: string; color?: string };

export const useProjectsStore = defineStore('projects', () => {
	const authStore = useAuthStore();

	// list is the source of truth so every useProjects() instance stays in sync
	const list = ref<Project[]>([]);
	const listInFlight = ref<Promise<Project[]> | null>(null);

	const authHeaders = (): Record<string, string> => bearerHeaders(authStore.sessionToken);

	const get = (id: number): Project | undefined => list.value.find((project) => project.id === id);

	const listProjects = async (): Promise<Project[]> => {
		if (listInFlight.value) return listInFlight.value;

		const promise = (async () => {
			try {
				const projects = await $fetch<Project[]>(`/api/projects`, {
					cache: 'no-store',
					credentials: 'include',
					headers: authHeaders()
				});
				list.value = projects;
				return projects;
			} catch (error) {
				console.error('Failed to list projects:', error);
				return list.value;
			} finally {
				listInFlight.value = null;
			}
		})();

		listInFlight.value = promise;
		return promise;
	};

	const createProject = async (body: ProjectInput): Promise<Project> => {
		try {
			const project = await $fetch<Project>(`/api/projects`, {
				method: 'POST',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			list.value = [...list.value, project];
			return project;
		} catch (error) {
			console.error('Failed to create project:', error);
			throw error;
		}
	};

	const updateProject = async (id: number, body: Partial<ProjectInput>): Promise<Project> => {
		try {
			const project = await $fetch<Project>(`/api/projects/${id}`, {
				method: 'PATCH',
				body,
				credentials: 'include',
				headers: authHeaders()
			});
			list.value = list.value.map((existing) => (existing.id === id ? project : existing));
			return project;
		} catch (error) {
			console.error(`Failed to update project "${id}":`, error);
			throw error;
		}
	};

	const deleteProject = async (id: number): Promise<void> => {
		try {
			await $fetch(`/api/projects/${id}`, {
				method: 'DELETE',
				credentials: 'include',
				headers: authHeaders()
			});
			list.value = list.value.filter((existing) => existing.id !== id);
		} catch (error) {
			console.error(`Failed to delete project "${id}":`, error);
			throw error;
		}
	};

	return { list, get, listProjects, createProject, updateProject, deleteProject };
});
