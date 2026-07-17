<template>
	<div class="mx-auto flex max-w-5xl flex-col gap-6">
		<div>
			<h1 class="text-2xl font-semibold">Projects</h1>
			<p class="text-sm text-slate-500">Group tickets into projects and track their volume.</p>
		</div>

		<div
			v-if="pending && !projects.length"
			class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
		>
			<USkeleton
				v-for="n in 3"
				:key="n"
				class="h-24 rounded-lg"
			/>
		</div>

		<div
			v-else-if="!projects.length"
			class="rounded-lg border border-dashed border-slate-300 px-4 py-12 text-center text-sm text-slate-500 dark:border-slate-700"
		>
			No projects yet. Create one below to start grouping tickets.
		</div>

		<div
			v-else
			class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
		>
			<UContextMenu
				v-for="project in projects"
				:key="project.id"
				:items="projectMenu(project)"
			>
				<NuxtLink
					:to="`/dashboard/projects/${project.id}`"
					class="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/50"
				>
					<div class="flex items-center gap-2">
						<span
							class="size-3 shrink-0 rounded-full border border-slate-300 dark:border-slate-600"
							:style="{ backgroundColor: project.color || '#94a3b8' }"
						/>
						<span class="truncate font-medium">{{ project.name }}</span>
					</div>
					<p
						v-if="project.description"
						class="line-clamp-2 text-xs text-slate-500"
					>
						{{ project.description }}
					</p>
					<USkeleton
						v-if="ticketsPending"
						class="mt-auto h-4 w-16 rounded"
					/>
					<span
						v-else
						class="mt-auto text-xs text-slate-400"
						>{{ countFor(project.id) }} Tickets</span
					>
				</NuxtLink>
			</UContextMenu>
		</div>

		<section
			v-if="canManage"
			class="flex flex-col gap-3"
		>
			<h2 class="text-sm font-semibold">Manage Projects</h2>
			<SettingsProjects />
		</section>
	</div>
</template>

<script setup lang="ts">
import { Permission } from '~/shared/types/user';

definePageMeta({ layout: 'dashboard', middleware: 'staff' });

const { can, isAdmin } = useAuth();
const { projectMenu } = useEntityMenus();
const canManage = computed(() => isAdmin.value || can(Permission.ManageSettings));

const { projects, pending } = useProjects();
const { tickets, pending: ticketsPending } = useTickets(() => ({ limit: 100 }));

function countFor(id: number): number {
	return tickets.value.filter(
		(ticket) => ticket.project_ids?.includes(id) ?? ticket.project_id === id
	).length;
}

useSeoMeta({ title: 'Projects' });
</script>
