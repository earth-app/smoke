<template>
	<div class="flex min-h-screen flex-col bg-white dark:bg-slate-950">
		<Navbar />
		<main
			id="main-content"
			tabindex="-1"
			class="w-full flex-1 focus:outline-none"
		>
			<PageContextMenu>
				<slot />
			</PageContextMenu>
		</main>
		<Footer />
	</div>
</template>
