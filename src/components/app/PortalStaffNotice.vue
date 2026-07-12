<template>
	<UCard class="mx-auto w-full max-w-md">
		<div class="flex flex-col items-center gap-4 py-6 text-center">
			<UIcon
				name="mdi:shield-account-outline"
				class="size-12 text-primary"
			/>
			<div>
				<h2 class="text-xl font-semibold">You're Signed in as Staff</h2>
				<p class="mt-2 text-muted">
					The customer portal is for the people you support. Head to your dashboard to manage
					requests.
				</p>
			</div>
			<UButton
				to="/dashboard"
				color="primary"
				icon="mdi:view-dashboard-outline"
				size="lg"
			>
				Go to Dashboard
			</UButton>
		</div>
	</UCard>
</template>
