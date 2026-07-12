<template>
	<div :class="['flex gap-3', isAgent ? 'flex-row-reverse text-right' : 'flex-row']">
		<Avatar
			:avatar="message.sender.avatar_url"
			:id="senderUserId"
			:name="senderName"
			:role="senderRole"
			size="sm"
			class="mt-1 shrink-0"
		/>
		<div class="min-w-0 flex-1">
			<div :class="['flex items-center gap-2', isAgent ? 'justify-end' : 'justify-start']">
				<span class="text-sm font-medium">{{ senderName }}</span>
				<UBadge
					:color="isAgent ? 'primary' : 'neutral'"
					variant="subtle"
					size="xs"
					>{{ isAgent ? 'Team' : 'Customer' }}</UBadge
				>
				<UBadge
					v-if="senderRoleLabel"
					color="neutral"
					variant="outline"
					size="xs"
					>{{ senderRoleLabel }}</UBadge
				>
				<UBadge
					v-if="isAiSender"
					color="primary"
					variant="subtle"
					size="xs"
					icon="mdi:robot"
					>AI</UBadge
				>
				<UBadge
					v-if="message.private"
					color="warning"
					variant="subtle"
					size="xs"
					icon="mdi:lock-outline"
					>Internal</UBadge
				>
				<span class="text-xs text-slate-400">{{ timestamp }}</span>
				<span
					v-if="message.edited_at"
					class="text-xs italic text-slate-400"
					:title="editedTitle"
					>{{ editedLabel }}</span
				>
				<UButton
					v-if="hasHistory && !compact"
					color="neutral"
					variant="ghost"
					size="xs"
					:icon="showHistory ? 'mdi:eye-off-outline' : 'mdi:history'"
					@click="toggleHistory"
					>{{ showHistory ? 'Hide Changes' : 'View Changes' }}</UButton
				>

				<div
					v-if="(canEdit || canDelete) && !editing && !compact"
					class="flex items-center gap-0.5"
				>
					<UButton
						v-if="canEdit"
						color="neutral"
						variant="ghost"
						size="xs"
						icon="mdi:pencil"
						:aria-label="'Edit Message'"
						@click="startEdit"
					/>
					<UButton
						v-if="canDelete"
						color="error"
						variant="ghost"
						size="xs"
						icon="mdi:delete"
						:aria-label="'Delete Message'"
						:loading="deleting"
						@click="remove"
					/>
				</div>
			</div>

			<div
				v-if="editing"
				class="mt-1"
			>
				<UTextarea
					v-model="draft"
					:rows="3"
					autoresize
					:maxrows="12"
					class="w-full"
					:disabled="saving"
				/>
				<div class="mt-2 flex items-center gap-2">
					<UButton
						color="primary"
						size="xs"
						icon="mdi:check"
						:loading="saving"
						:disabled="!draft.trim()"
						@click="save"
						>Save</UButton
					>
					<UButton
						color="neutral"
						variant="soft"
						size="xs"
						icon="mdi:close"
						:disabled="saving"
						@click="cancelEdit"
						>Cancel</UButton
					>
				</div>
			</div>

			<template v-else>
				<p
					v-if="compact"
					class="mt-1 whitespace-pre-wrap break-words text-left text-sm text-slate-700 dark:text-slate-200"
				>
					{{ message.message }}
				</p>

				<template v-else>
					<div
						:class="[
							'ticket-message-body mt-1 inline-block max-w-full rounded-lg px-3 py-2 text-left text-sm',
							'prose prose-sm max-w-none dark:prose-invert',
							isAgent
								? 'bg-primary-50 text-slate-800 dark:bg-primary-950 dark:text-slate-100'
								: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
						]"
						v-html="renderedBody"
					/>

					<div
						v-if="links.length"
						:class="['mt-2 flex flex-wrap gap-2', isAgent ? 'justify-end' : 'justify-start']"
					>
						<TicketEmbed
							v-for="link in links"
							:key="link"
							:url="link"
						/>
					</div>
				</template>
			</template>

			<div
				v-if="hasHistory && showHistory && !compact"
				class="mt-2 space-y-2 text-left"
			>
				<div
					v-if="history.length > 1"
					class="flex items-center gap-2"
				>
					<span class="text-xs text-slate-500">Compare With</span>
					<USelect
						v-model="selectedVersion"
						:items="versionItems"
						size="xs"
						class="w-52"
					/>
				</div>
				<TicketDiff
					:before="beforeText"
					:after="message.message"
				/>
			</div>

			<div
				v-if="message.attachments?.length && !compact"
				:class="['mt-2 flex flex-wrap gap-2', isAgent ? 'justify-end' : 'justify-start']"
			>
				<span
					v-for="attachment in message.attachments"
					:key="attachment.id"
					class="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
				>
					<UIcon
						name="mdi:paperclip"
						class="size-3.5"
					/>
					{{ attachment.file_name }}
				</span>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import type { TicketMessage, TicketMessageVersion } from '~/shared/types/ticket';
import { Permission } from '~/shared/types/user';
import { useTicketStore } from '~/stores/ticket';

const props = withDefaults(defineProps<{ message: TicketMessage; compact?: boolean }>(), {
	compact: false
});

const toast = useToast();
const { user, sessionToken, can } = useAuth();
const { renderMarkdown } = useMarkdown();
const ticketStore = useTicketStore();

const editing = ref(false);
const saving = ref(false);
const deleting = ref(false);
const draft = ref('');

const isAgent = computed(() => props.message.sender.kind === 'user');

const senderName = computed(() => {
	const sender = props.message.sender;
	if (sender.kind === 'user') return sender.name || sender.username || 'Team';
	return sender.name || sender.email || 'Customer';
});

// only user-kind senders carry an id/role/ai tag
const senderUserId = computed(() =>
	props.message.sender.kind === 'user' ? props.message.sender.id : undefined
);

const senderRole = computed(() =>
	props.message.sender.kind === 'user' ? props.message.sender.role : undefined
);

const senderRoleLabel = computed(() => {
	const sender = props.message.sender;
	if (sender.kind !== 'user' || !sender.role) return '';
	return sender.role.charAt(0).toUpperCase() + sender.role.slice(1);
});

const isAiSender = computed(
	() => props.message.sender.kind === 'user' && props.message.sender.ai === true
);

const timestamp = computed(() => {
	const date = new Date(props.message.created_at);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleString();
});

const editedTitle = computed(() => {
	if (!props.message.edited_at) return '';
	const date = new Date(props.message.edited_at);
	return Number.isNaN(date.getTime()) ? 'Edited' : `Edited ${date.toLocaleString()}`;
});

// resolve a different-editor id to a name via the thread participants, then the signed-in user
const editorName = computed(() => {
	const editorId = props.message.edited_by;
	if (!editorId) return '';
	const thread = ticketStore.threads.get(props.message.ticket_id);
	const match = thread?.users.find(
		(u: any) => u.kind !== 'customer' && String(u.id) === String(editorId)
	);
	if (match) return displayName(match as any);
	if (user.value && String(user.value.id) === String(editorId)) return displayName(user.value);
	return '';
});

const editedLabel = computed(() => {
	if (!props.message.edited_by) return 'Edited';
	return editorName.value ? `Edited by ${editorName.value}` : 'Edited by a Team Member';
});

const renderedBody = computed(() => renderMarkdown(props.message.message));
const links = computed(() => detectLinks(props.message.message).slice(0, 4));

// prior versions (newest-last) for the inline edit-history diff
const history = computed<TicketMessageVersion[]>(() => props.message.edit_history ?? []);
const hasHistory = computed(() => history.value.length > 0);
const showHistory = ref(false);
const selectedVersion = ref(0);

const versionItems = computed(() =>
	history.value.map((version, index) => ({ label: versionLabel(version, index), value: index }))
);

function versionLabel(version: TicketMessageVersion, index: number): string {
	const date = new Date(version.edited_at);
	return Number.isNaN(date.getTime()) ? `Version ${index + 1}` : date.toLocaleString();
}

// the chosen prior version's body is the "before"; the live message is the "after"
const beforeText = computed(() => history.value[selectedVersion.value]?.message ?? '');

function toggleHistory() {
	if (!showHistory.value) selectedVersion.value = Math.max(0, history.value.length - 1);
	showHistory.value = !showHistory.value;
}

// only user-kind messages authored by the signed-in agent count as own
const isOwn = computed(
	() =>
		props.message.sender.kind === 'user' &&
		!!user.value &&
		String(props.message.sender.id) === String(user.value.id)
);

const canEdit = computed(() => isOwn.value || can(Permission.ManageTicketMessages));
const canDelete = computed(() => isOwn.value || can(Permission.ManageTicketMessages));

function authHeaders(): Record<string, string> {
	return sessionToken.value ? { Authorization: `Bearer ${sessionToken.value}` } : {};
}

function startEdit() {
	draft.value = props.message.message;
	editing.value = true;
}

function cancelEdit() {
	editing.value = false;
	draft.value = '';
}

async function save() {
	const message = draft.value.trim();
	if (!message || saving.value) return;
	saving.value = true;
	try {
		await $fetch(`/api/tickets/${props.message.ticket_id}/messages/${props.message.id}`, {
			method: 'PATCH',
			body: { message },
			credentials: 'include',
			headers: authHeaders()
		});
		await ticketStore.fetchThread(props.message.ticket_id, true);
		editing.value = false;
		toast.add({
			title: 'Message Updated',
			description: 'Your changes were saved.',
			icon: 'mdi:check',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Update Message',
			description: extractServerMessage(error, 'Could not save your changes. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		saving.value = false;
	}
}

async function remove() {
	if (deleting.value) return;
	if (!confirm('Delete this message? This action cannot be undone.')) return;
	deleting.value = true;
	try {
		await $fetch(`/api/tickets/${props.message.ticket_id}/messages/${props.message.id}`, {
			method: 'DELETE',
			credentials: 'include',
			headers: authHeaders()
		});
		await ticketStore.fetchThread(props.message.ticket_id, true);
		toast.add({
			title: 'Message Deleted',
			description: 'The message was removed from the ticket.',
			icon: 'mdi:delete',
			color: 'success',
			duration: 3000
		});
	} catch (error) {
		toast.add({
			title: 'Failed to Delete Message',
			description: extractServerMessage(error, 'Could not delete the message. Please try again.'),
			icon: 'mdi:alert-circle',
			color: 'error',
			duration: 4000
		});
	} finally {
		deleting.value = false;
	}
}
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
	list-style-position: outside;
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
.ticket-message-body :deep(blockquote) {
	margin: 0.25rem 0;
	border-left: 3px solid var(--ui-border-accented, #cbd5e1);
	padding-left: 0.75rem;
	color: inherit;
	opacity: 0.85;
}
</style>
