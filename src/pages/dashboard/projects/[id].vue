<template>
	<div class="mx-auto flex max-w-5xl flex-col gap-5">
		<UButton
			to="/dashboard/projects"
			color="neutral"
			variant="ghost"
			icon="mdi:arrow-left"
			class="self-start"
			>All Projects</UButton
		>

		<div
			v-if="projectsPending && !project"
			class="flex flex-wrap items-start justify-between gap-3"
		>
			<div class="flex items-start gap-3">
				<USkeleton class="mt-1 size-4 shrink-0 rounded-full" />
				<div class="space-y-2">
					<USkeleton class="h-8 w-48" />
					<USkeleton class="h-4 w-64" />
				</div>
			</div>
			<USkeleton class="h-9 w-32 rounded-md" />
		</div>
		<div
			v-else-if="project"
			class="flex flex-wrap items-start justify-between gap-3"
		>
			<div class="flex items-start gap-3">
				<span
					class="mt-1 size-4 shrink-0 rounded-full border border-slate-300 dark:border-slate-600"
					:style="{ backgroundColor: project.color || '#94a3b8' }"
				/>
				<div>
					<h1 class="text-2xl font-semibold">{{ project.name }}</h1>
					<p
						v-if="project.description"
						class="text-sm text-slate-500"
					>
						{{ project.description }}
					</p>
				</div>
			</div>
			<ProjectAddTicket
				:project-id="id"
				@changed="() => listTickets()"
			/>
		</div>
		<div
			v-else
			class="text-2xl font-semibold"
		>
			Project Not Found
		</div>

		<TicketList
			:tickets="projectTickets"
			:pending="pending"
		/>
	</div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'staff' });

const route = useRoute();
const id = computed(() => Number(route.params.id));

const { getProject, pending: projectsPending } = useProjects();
const project = computed(() => getProject(id.value));

const { tickets, pending, listTickets } = useTickets(() => ({
	limit: 100,
	sort: 'updated_at',
	sort_direction: 'desc'
}));
const projectTickets = computed(() =>
	tickets.value.filter(
		(ticket) => ticket.project_ids?.includes(id.value) ?? ticket.project_id === id.value
	)
);

useSeoMeta({ title: () => (project.value ? `Project: ${project.value.name}` : 'Project') });
</script>
