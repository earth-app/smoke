<template>
	<UContextMenu
		:items="customerMenu(customer, { onEditTags: editable ? () => emit('edit-tags') : undefined })"
	>
		<div
			class="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
		>
			<div class="flex items-start gap-4">
				<Avatar
					:avatar="customer.avatar_url"
					:name="customer.name || customer.email"
					size="lg"
				/>
				<div class="min-w-0 flex-1">
					<h2 class="truncate text-lg font-semibold">{{ customer.name || 'Unnamed Customer' }}</h2>
					<a
						:href="`mailto:${customer.email}`"
						class="flex items-center gap-1 text-sm text-primary-500 hover:underline"
					>
						<UIcon
							name="mdi:email-outline"
							class="size-4"
						/>
						{{ customer.email }}
					</a>
					<p class="mt-1 text-xs text-slate-400">Customer since {{ createdLabel }}</p>
				</div>
			</div>

			<div class="mt-4">
				<div class="mb-2 flex items-center justify-between">
					<p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Tags</p>
					<UTooltip
						v-if="editable"
						text="Edit Tags"
					>
						<UButton
							size="xs"
							color="neutral"
							variant="ghost"
							icon="mdi:pencil-outline"
							aria-label="Edit Tags"
							@click="$emit('edit-tags')"
						/>
					</UTooltip>
				</div>
				<div
					v-if="customer.tags?.length"
					class="flex flex-wrap gap-1.5"
				>
					<LabelBadge
						v-for="tag in customer.tags"
						:key="tag.id"
						:label="tag"
					/>
				</div>
				<p
					v-else
					class="text-sm text-slate-400"
				>
					No tags yet.
				</p>
			</div>
		</div>
	</UContextMenu>
</template>

<script setup lang="ts">
import type { Customer } from '~/shared/types/user';

const props = withDefaults(defineProps<{ customer: Customer; editable?: boolean }>(), {
	editable: false
});
const emit = defineEmits<{ 'edit-tags': [] }>();

const { customerMenu } = useEntityMenus();

const createdLabel = computed(() => {
	const date = new Date(props.customer.created_at);
	return Number.isNaN(date.getTime()) ? 'recently' : date.toLocaleDateString();
});
</script>
