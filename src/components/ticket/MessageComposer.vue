<template>
	<div
		class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
	>
		<UTextarea
			v-model="text"
			:rows="3"
			autoresize
			:maxrows="10"
			placeholder="Write a reply..."
			class="w-full"
			:disabled="sending"
		/>

		<div
			v-if="attachments.length"
			class="mt-2 flex flex-wrap gap-2"
		>
			<span
				v-for="(file, index) in attachments"
				:key="index"
				class="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
			>
				<UIcon
					name="mdi:paperclip"
					class="size-3.5"
				/>
				{{ file.name }}
				<button
					type="button"
					class="opacity-70 hover:opacity-100"
					:aria-label="`Remove ${file.name}`"
					@click="removeAttachment(index)"
				>
					<UIcon
						name="mdi:close"
						class="size-3"
					/>
				</button>
			</span>
		</div>

		<div class="mt-3 flex flex-wrap items-center gap-3">
			<UButton
				color="neutral"
				variant="soft"
				icon="mdi:paperclip"
				size="sm"
				:disabled="sending"
				@click="pickFiles"
				>Attach</UButton
			>
			<input
				ref="fileInput"
				type="file"
				multiple
				class="hidden"
				@change="onFilesChosen"
			/>

			<div class="flex items-center gap-2">
				<span class="text-sm text-slate-500">Reply as</span>
				<USelect
					v-model="identity"
					:items="identityItems"
					size="sm"
					class="w-32"
					:disabled="sending"
				/>
			</div>

			<UButton
				color="primary"
				icon="mdi:send"
				size="sm"
				class="ml-auto"
				:loading="sending"
				:disabled="!canSend"
				@click="submit"
				>Send Reply</UButton
			>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { TicketAttachmentInput } from '~/shared/types/ticket';

const props = withDefaults(
	defineProps<{ sending?: boolean; defaultIdentity?: 'self' | 'team' }>(),
	{ sending: false, defaultIdentity: 'team' }
);

const emit = defineEmits<{
	send: [
		payload: { message: string; identity: 'self' | 'team'; attachments: TicketAttachmentInput[] }
	];
}>();

const text = ref('');
const identity = ref<'self' | 'team'>(props.defaultIdentity);
const attachments = ref<File[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

const identityItems = [
	{ label: 'Team', value: 'team' },
	{ label: 'Myself', value: 'self' }
];

const canSend = computed(() => !props.sending && text.value.trim().length > 0);

function pickFiles() {
	fileInput.value?.click();
}

function onFilesChosen(event: Event) {
	const target = event.target as HTMLInputElement;
	if (target.files) attachments.value.push(...Array.from(target.files));
	target.value = '';
}

function removeAttachment(index: number) {
	attachments.value.splice(index, 1);
}

// read a file into the base64 data-uri shape the attachments api expects
function readFile(file: File): Promise<TicketAttachmentInput> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () =>
			resolve({
				data: String(reader.result),
				file_name: file.name,
				mimetype: file.type || 'application/octet-stream'
			});
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

async function submit() {
	if (!canSend.value) return;
	const encoded = await Promise.all(attachments.value.map(readFile));
	emit('send', {
		message: text.value.trim(),
		identity: identity.value,
		attachments: encoded
	});
}

function reset() {
	text.value = '';
	attachments.value = [];
}

defineExpose({ reset });
</script>
