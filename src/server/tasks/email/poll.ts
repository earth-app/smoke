import { ensureCollegeDB } from 'hub:db:schema';

// scheduled inbound poll; no-ops unless a mailbox is configured + enabled in settings.
// creds resolve sealed-kv-first (settings) then these env vars as a fallback; db/kv are hub bindings
export default defineTask({
	meta: {
		name: 'email:poll',
		description: 'Poll a configured imap/pop3 mailbox and thread new mail into tickets'
	},
	async run() {
		const env = {
			MASTER_KEY: process.env.MASTER_KEY,
			HMAC_SECRET: process.env.HMAC_SECRET,
			POLL_USER: process.env.POLL_USER,
			POLL_PASS: process.env.POLL_PASS
		} as any;

		// missing secrets -> cannot decrypt/thread; skip quietly so a deploy never breaks
		if (!env.MASTER_KEY || !env.HMAC_SECRET) {
			return { result: { processed: 0, skipped: 'not-configured' } };
		}

		// edgeport imap/pop3 needs cloudflare:sockets, which only exist on the workers runtime; the
		// node dev server + e2e preview can't import it, so skip cleanly rather than warn every tick
		if (import.meta.dev || process.env.NUXT_PUBLIC_E2E === '1') {
			return { result: { processed: 0, skipped: 'unsupported-runtime' } };
		}

		try {
			ensureCollegeDB(env);
			const out = await pollInboundMailbox(env);
			return { result: out };
		} catch (error) {
			console.warn('scheduled email poll failed', error);
			return { result: { processed: 0, error: String(error) } };
		}
	}
});
