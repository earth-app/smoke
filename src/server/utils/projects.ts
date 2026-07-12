import type { Project } from '~/shared/types/ticket';

// projects live in settings kv (no db migration); ids increment via max-id+1 in the stored array
const KEY = 'smoke:setting:projects';

type StoredProject = Omit<Project, 'created_at'> & { created_at: string };

export type ProjectInput = {
	name: string;
	description?: string;
	color?: string;
};

async function readProjects(): Promise<StoredProject[]> {
	try {
		const raw = await kv.get<StoredProject[]>(KEY, 'json');
		return Array.isArray(raw) ? raw : [];
	} catch {
		return [];
	}
}

async function writeProjects(projects: StoredProject[]): Promise<void> {
	await kv.set(KEY, JSON.stringify(projects));
}

function hydrate(project: StoredProject): Project {
	return {
		id: project.id,
		name: project.name,
		description: project.description || undefined,
		color: project.color || undefined,
		created_at: new Date(project.created_at)
	};
}

export async function listProjects(): Promise<Project[]> {
	return (await readProjects()).map(hydrate);
}

export async function getProjectById(id: number): Promise<Project | null> {
	const found = (await readProjects()).find((project) => project.id === id);
	return found ? hydrate(found) : null;
}

export async function createProject(input: ProjectInput): Promise<Project> {
	const projects = await readProjects();
	const nextId = projects.reduce((max, project) => Math.max(max, project.id), 0) + 1;
	const stored: StoredProject = {
		id: nextId,
		name: input.name.trim(),
		description: input.description?.trim() || undefined,
		color: input.color?.trim() || undefined,
		created_at: new Date().toISOString()
	};
	projects.push(stored);
	await writeProjects(projects);
	return hydrate(stored);
}

export async function updateProject(id: number, updates: Partial<ProjectInput>): Promise<Project> {
	const projects = await readProjects();
	const index = projects.findIndex((project) => project.id === id);
	if (index === -1) {
		throw createError({ statusCode: 404, message: 'Project not found' });
	}

	const current = projects[index]!;
	const next: StoredProject = {
		...current,
		name: updates.name !== undefined ? updates.name.trim() : current.name,
		description:
			updates.description !== undefined
				? updates.description.trim() || undefined
				: current.description,
		color: updates.color !== undefined ? updates.color.trim() || undefined : current.color
	};
	projects[index] = next;
	await writeProjects(projects);
	return hydrate(next);
}

export async function deleteProject(id: number): Promise<void> {
	const projects = await readProjects();
	const filtered = projects.filter((project) => project.id !== id);
	if (filtered.length === projects.length) {
		throw createError({ statusCode: 404, message: 'Project not found' });
	}
	await writeProjects(filtered);
}
