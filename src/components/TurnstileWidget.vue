<template>
	<ClientOnly>
		<div v-if="siteKey">
			<NuxtTurnstile
				v-if="!isTestKey"
				ref="turnstile"
				v-model="token"
				:options="turnstileOptions"
			/>
		</div>
	</ClientOnly>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
const toast = useToast();
const siteKey = config.public.turnstile.siteKey;

// cloudflare test keys never reach challenges.cloudflare.com; short-circuit for offline dev/e2e
const isTestKey = /^[123]x0000/.test(siteKey);

const emit = defineEmits<{
	(event: 'received-token', token: string): void;
	(event: 'error', message: string): void;
	(event: 'expired'): void;
}>();

const token = ref('');
watch(token, (next) => {
	if (next) emit('received-token', next);
});

const turnstile = ref();
const turnstileOptions: Omit<Partial<Turnstile.RenderParameters>, 'callback'> = {
	'error-callback': onError,
	'expired-callback': onExpired,
	'timeout-callback': onTimeout
};

function onError(error: string) {
	toast.add({
		title: 'Turnstile Error',
		description: `Cloudflare Error Code: ${error}`,
		icon: 'mdi:lock-alert-outline',
		color: 'error'
	});
	emit('error', error);
}

function onExpired() {
	toast.add({
		title: 'Turnstile Expired',
		description: 'The verification has expired. Please complete it again.',
		icon: 'mdi:lock-alert-outline',
		color: 'warning'
	});
	emit('expired');
}

function onTimeout() {
	toast.add({
		title: 'Turnstile Timeout',
		description: 'The verification has timed out. Please complete it again.',
		icon: 'mdi:lock-clock',
		color: 'warning'
	});
	emit('error', 'Turnstile verification timed out');
}

// test keys can't render offline; hand back a dummy token so forms stay submittable
onMounted(() => {
	if (siteKey && isTestKey) nextTick(() => (token.value = 'XXXX.DUMMY.TOKEN.XXXX'));
});

defineExpose({
	reset: () => {
		token.value = '';
		if (turnstile.value) turnstile.value.reset();
	}
});
</script>
