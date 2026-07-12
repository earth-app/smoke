<template>
	<div
		v-if="password"
		class="flex flex-col gap-2"
	>
		<div class="flex items-center gap-1">
			<div
				v-for="segment in 4"
				:key="segment"
				class="h-1.5 flex-1 rounded-full transition-colors"
				:class="segment <= strength.score ? meta.bar : 'bg-accented'"
			/>
		</div>

		<div class="flex items-center justify-between gap-2">
			<span class="text-xs text-muted">Password Strength</span>
			<span
				class="text-xs font-semibold"
				:class="meta.text"
				>{{ meta.label }}</span
			>
		</div>

		<ul
			v-if="unmet.length"
			class="flex flex-col gap-0.5"
		>
			<li
				v-for="requirement in unmet"
				:key="requirement.key"
				class="flex items-center gap-1.5 text-xs text-muted"
			>
				<UIcon
					name="mdi:circle-small"
					class="size-4 shrink-0"
				/>
				<span>{{ requirement.label }}</span>
			</li>
		</ul>
	</div>
</template>

<script setup lang="ts">
import type { PasswordLevel } from '~/utils/password-strength';

const props = defineProps<{ password: string }>();

const strength = computed(() => passwordStrength(props.password || ''));

const LEVEL_META: Record<PasswordLevel, { label: string; bar: string; text: string }> = {
	none: { label: 'None', bar: 'bg-accented', text: 'text-muted' },
	low: { label: 'Low', bar: 'bg-error', text: 'text-error' },
	medium: { label: 'Medium', bar: 'bg-warning', text: 'text-warning' },
	strong: { label: 'Strong', bar: 'bg-primary', text: 'text-primary' },
	best: { label: 'Best', bar: 'bg-success', text: 'text-success' }
};

const meta = computed(() => LEVEL_META[strength.value.level]);

const requirements = computed(() => {
	const c = strength.value.categories;
	const length = (props.password || '').length;
	return [
		{
			key: 'length',
			label: `At least ${PASSWORD_MIN_LENGTH} characters`,
			met: length >= PASSWORD_MIN_LENGTH
		},
		{ key: 'lowercase', label: 'One lowercase letter', met: c.lowercase >= 1 },
		{ key: 'uppercase', label: 'One uppercase letter', met: c.uppercase >= 1 },
		{ key: 'digit', label: 'One number', met: c.digit >= 1 },
		{ key: 'special', label: 'One special character', met: c.special >= 1 }
	];
});

const unmet = computed(() => requirements.value.filter((requirement) => !requirement.met));
</script>
