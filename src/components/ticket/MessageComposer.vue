<template>
	<div
		ref="rootEl"
		class="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
	>
		<div class="mb-2 flex flex-wrap items-center gap-1">
			<UButton
				color="neutral"
				variant="ghost"
				size="xs"
				icon="mdi:format-bold"
				aria-label="Bold"
				:disabled="sending || preview"
				@click="wrap('**')"
			/>
			<UButton
				color="neutral"
				variant="ghost"
				size="xs"
				icon="mdi:format-italic"
				aria-label="Italic"
				:disabled="sending || preview"
				@click="wrap('*')"
			/>
			<UButton
				color="neutral"
				variant="ghost"
				size="xs"
				icon="mdi:code-tags"
				aria-label="Inline Code"
				:disabled="sending || preview"
				@click="wrap('`')"
			/>
			<UButton
				color="neutral"
				variant="ghost"
				size="xs"
				icon="mdi:link-variant"
				aria-label="Link"
				:disabled="sending || preview"
				@click="wrap('[', '](https://)')"
			/>
			<UButton
				color="neutral"
				variant="ghost"
				size="xs"
				icon="mdi:format-list-bulleted"
				aria-label="Bullet List"
				:disabled="sending || preview"
				@click="insert('\n- ')"
			/>

			<UPopover>
				<UButton
					color="neutral"
					variant="ghost"
					size="xs"
					icon="mdi:emoticon-happy-outline"
					aria-label="Insert Emoji"
					:disabled="sending || preview"
				/>
				<template #content>
					<div class="grid max-w-64 grid-cols-8 gap-0.5 p-2">
						<button
							v-for="emoji in EMOJIS"
							:key="emoji"
							type="button"
							class="rounded p-1 text-lg leading-none hover:bg-slate-100 dark:hover:bg-slate-800"
							@click="insert(emoji)"
						>
							{{ emoji }}
						</button>
					</div>
				</template>
			</UPopover>

			<UButton
				color="neutral"
				:variant="preview ? 'soft' : 'ghost'"
				size="xs"
				:icon="preview ? 'mdi:pencil-outline' : 'mdi:eye-outline'"
				class="ml-auto"
				:disabled="sending"
				@click="
					() => {
						preview = !preview;
					}
				"
				>{{ preview ? 'Edit' : 'Preview' }}</UButton
			>
		</div>

		<UTextarea
			v-show="!preview"
			v-model="text"
			:rows="3"
			autoresize
			:maxrows="12"
			placeholder="Write a reply... (Markdown supported)"
			class="w-full"
			:disabled="sending"
		/>
		<div
			v-show="preview"
			class="ticket-message-body prose prose-sm min-h-20 max-w-none rounded-lg border border-slate-200 px-3 py-2 text-sm dark:prose-invert dark:border-slate-800"
		>
			<div
				v-if="text.trim()"
				v-html="renderedPreview"
			/>
			<p
				v-else
				class="text-slate-400"
			>
				Nothing to preview yet.
			</p>
		</div>

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

		<div
			v-if="showCc"
			class="mt-2"
		>
			<UFormField
				label="Cc"
				size="sm"
			>
				<UInput
					v-model="ccText"
					placeholder="name@example.com, another@example.com"
					class="w-full"
					:disabled="sending"
				/>
			</UFormField>
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

			<UButton
				color="neutral"
				:variant="showCc ? 'soft' : 'ghost'"
				icon="mdi:account-multiple-plus-outline"
				size="sm"
				:disabled="sending"
				@click="toggleCc"
				>Cc</UButton
			>
			<input
				ref="fileInput"
				type="file"
				multiple
				class="hidden"
				@change="onFilesChosen"
			/>

			<TicketAiDraftButton
				v-if="ticketId"
				:ticket-id="ticketId"
				@draft="onDraft"
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

// robust fallback over @nuxt/ui UEditor: a markdown textarea + live preview + emoji/format helpers.
// UEditor round-trips content through prosemirror, which can rewrite the agent's raw markdown and
// carries client-only hydration risk we can't verify without a build; a textarea preserves the
// markdown string v-model exactly and is ssr-safe.
const props = withDefaults(
	defineProps<{ sending?: boolean; defaultIdentity?: 'self' | 'team'; ticketId?: number }>(),
	{ sending: false, defaultIdentity: 'team' }
);

const emit = defineEmits<{
	send: [
		payload: {
			message: string;
			identity: 'self' | 'team';
			attachments: TicketAttachmentInput[];
			cc: string[];
		}
	];
}>();

const { renderMarkdown } = useMarkdown();

const text = ref('');
const preview = ref(false);
const identity = ref<'self' | 'team'>(props.defaultIdentity);
const attachments = ref<File[]>([]);
const showCc = ref(false);
const ccText = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const rootEl = ref<HTMLElement | null>(null);

const identityItems = [
	{ label: 'Team', value: 'team', icon: 'mdi:account-group-outline' },
	{ label: 'Myself', value: 'self', icon: 'mdi:account' }
];

// prettier-ignore
const EMOJIS = [
	'👍', '👎', '🙏', '👏', '🙌', '💪', '👀', '🎉', '🔥', '✨',
	'✅', '❌', '⚠️', '💯', '⭐', '🚀', '💡', '🐛', '🔒', '🔔',
	'😄', '😉', '😊', '😅', '😂', '😎', '🤔', '😕', '😢', '😡',
	'❤️', '📌', '📝', '📎', '📧', '🔗', '⏳', '📅', '💬', '👌'
];

const canSend = computed(() => !props.sending && text.value.trim().length > 0);
const renderedPreview = computed(() => renderMarkdown(text.value));

function textarea(): HTMLTextAreaElement | null {
	return rootEl.value?.querySelector('textarea') ?? null;
}

// insert text at the caret (or append when the element isn't reachable)
function insert(value: string) {
	const el = textarea();
	if (!el) {
		text.value += value;
		return;
	}
	const start = el.selectionStart ?? text.value.length;
	const end = el.selectionEnd ?? text.value.length;
	text.value = text.value.slice(0, start) + value + text.value.slice(end);
	nextTick(() => {
		el.focus();
		const caret = start + value.length;
		el.setSelectionRange(caret, caret);
	});
}

// wrap the current selection with markdown markers
function wrap(before: string, after = before) {
	const el = textarea();
	if (!el) {
		text.value += before + after;
		return;
	}
	const start = el.selectionStart ?? 0;
	const end = el.selectionEnd ?? 0;
	const selected = text.value.slice(start, end);
	text.value = text.value.slice(0, start) + before + selected + after + text.value.slice(end);
	nextTick(() => {
		el.focus();
		el.setSelectionRange(start + before.length, start + before.length + selected.length);
	});
}

function toggleCc() {
	showCc.value = !showCc.value;
}

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
	const cc = ccText.value
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
	emit('send', {
		message: text.value.trim(),
		identity: identity.value,
		attachments: encoded,
		cc
	});
}

// fill the composer with an ai-suggested draft; append when the agent already typed something
function onDraft(draft: string) {
	text.value = text.value.trim() ? `${text.value.trim()}\n\n${draft}` : draft;
	preview.value = false;
}

function reset() {
	text.value = '';
	attachments.value = [];
	preview.value = false;
	ccText.value = '';
	showCc.value = false;
}

defineExpose({ reset });
</script>

<style scoped>
.ticket-message-body :deep(p) {
	margin: 0;
}
.ticket-message-body :deep(p + p) {
	margin-top: 0.5rem;
}
.ticket-message-body :deep(ul),
.ticket-message-body :deep(ol) {
	margin: 0.25rem 0;
	padding-left: 1.25rem;
}
.ticket-message-body :deep(ul) {
	list-style-type: disc;
}
.ticket-message-body :deep(ol) {
	list-style-type: decimal;
}
.ticket-message-body :deep(a) {
	color: var(--ui-primary);
	text-decoration: underline;
}
.ticket-message-body :deep(code) {
	border-radius: 0.25rem;
	background: rgb(0 0 0 / 0.06);
	padding: 0.1rem 0.3rem;
	font-size: 0.85em;
}
.dark .ticket-message-body :deep(code) {
	background: rgb(255 255 255 / 0.1);
}
.ticket-message-body :deep(pre) {
	overflow-x: auto;
	border-radius: 0.375rem;
	background: rgb(0 0 0 / 0.06);
	padding: 0.5rem 0.75rem;
}
.dark .ticket-message-body :deep(pre) {
	background: rgb(255 255 255 / 0.08);
}
.ticket-message-body :deep(pre code) {
	background: transparent;
	padding: 0;
}
</style>
