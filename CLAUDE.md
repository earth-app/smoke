# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`@earth-app/smoke` — serverless customer support platform. Nuxt 4 SSR app deployed to Cloudflare Workers via NuxtHub. Package manager is **Bun**.

## Commands

```sh
bun run dev              # nuxi dev on port 4000, --no-restart --public
bun run build            # nuxt build (cloudflare_module preset in production)
bun run test             # vitest run (uses @cloudflare/vitest-pool-workers + wrangler.test.jsonc)
bun run test:watch       # vitest in watch mode
bun run test:coverage    # vitest with istanbul coverage (v8 native isn't available in Workers isolates)
bun run prettier         # write
bun run prettier:check   # CI gate (Husky pre-commit runs lint-staged → prettier)
```

Single test: `bunx vitest run tests/api/users/login.post.spec.ts` (or `-t "<name>"` to filter by test name).

Required env (see `.env.test` for example values; the test env keys are `'m'.repeat(32)` / `'h'.repeat(32)`):

- `MASTER_KEY` — ≥16 chars, used for envelope encryption of all PII.
- `HMAC_SECRET` — hex ≥32 bytes, used to HMAC emails for lookup (emails themselves are encrypted, so they can't be queried directly).

Email conversation engine (see the Email engine note below) — all required together; if any is missing the inbound handler degrades to a "not configured to receive emails" auto-reply and creates nothing:

- `CF_EMAIL_TOKEN` — Cloudflare API token with the **Email Sending: Edit** permission. Used as the SMTP password (`api_token` / `CF_EMAIL_TOKEN`) against `smtp.mx.cloudflare.net` for on-demand outbound via **Cloudflare Email Service** (the `edgeport/smtp` client).
- `SUPPORT_EMAIL` — base support address; reply aliases are `support+t<id>@<domain>`. Its domain must be onboarded to Cloudflare **Email Sending** (DKIM/SPF) for outbound, and have a **catch-all** Email Routing rule to this worker for inbound.
- `NUXT_PUBLIC_SITE_URL` — used for the ticket link in the auto-ack (optional; falls back to the configured site url).

## Layout

- `srcDir: 'src/'`, `serverDir: 'src/server/'`, shared at `src/shared/` (Nuxt 4 config).
- `src/server/api/` — file-based Nitro routes. `[id]/index.<method>.ts` is the standard shape.
- `src/server/db/schema.ts` — Drizzle table definitions; `ensureCollegeDB(env)` must run before any query in a request. Import the tables/`DB*` types/`ensureCollegeDB` from the `hub:db:schema` alias (NuxtHub re-exports this file there), not via a relative `~/server/db/schema` path.
- `src/server/utils/` — crypto, auth, sessions, and CRUD for users/customers/labels/tickets, split by domain (`auth.ts`, `user.ts`, `customer.ts`, `ticket.ts`, `label.ts`, `encryption.ts`, `request.ts`). Preserve the `// #region` boundaries within each file.
- `src/server/plugins/` — Nitro plugins (e.g. `email.ts` hooks `cloudflare:email` for inbound mail). NOT `src/plugins/`, which is for app plugins.
- `src/shared/types/{user,ticket}.ts` — domain types + `Role`, `Permission`, `DEFAULT_PERMISSIONS`.
- `src/shared/utils/schemas.ts` — Zod schemas used by routes.
- `src/utils/` — client/universal helpers (e.g. `request.ts` → `toSearchParams`, `QueryParameters`). Use this, never `~/server/utils`, from stores/composables/components.
- `src/stores/` — Pinia stores (`auth`, `user`). `src/composables/` wraps them.
- `tests/setup.ts` mocks h3 globals (`defineEventHandler`, `createError`, `readValidatedBody`, etc.) so server modules can be unit-tested outside Nitro.
- `tests/api/route-runtime.ts` builds an in-memory CollegeDB harness (in-memory SQL + KV providers, raw `CREATE TABLE` SQL) — use it for route tests instead of hitting real bindings.

## Architecture notes that matter

**Envelope encryption.** Every PII payload (`users.data`, `customers.data`, `tickets.messages_data`, `tickets.attachments_data`) is sealed with a per-row AES-256-GCM DEK; the DEK is wrapped by a KEK derived from `MASTER_KEY` via argon2id / scrypt / PBKDF2 (algorithm stored per-row in the `algorithm` column, alongside `wrapped_dek`, `nonce`, `tag`, `version`). When you add a new encrypted field, store it inside the existing `data` blob — don't add a new column unless you also add the full `_wrapped_dek`/`_nonce`/`_tag`/`_algorithm`/`_version` set (see how `tickets` does it for `messages_*` and `attachments_*`).

**Email lookup.** Because email is encrypted, lookups use `hmacSha256(env.HMAC_SECRET, email.trim().toLowerCase())` stored in `users.email_lookup`. Any code that lets a user change their email must update both the encrypted payload and the lookup hash (see `patchUser`).

**Sharding via CollegeDB.** Wrangler defines `DB`, `DB_SECONDARY`, `DB_TERTIARY` D1 bindings. `ensureCollegeDB(env)` auto-discovers anything starting with `DB_`/`DB-`/`db-` (skipping `KV`, `CACHE`, `EMAIL`, `ShardCoordinator`) and registers them as shards. Read strategy is `'location'`, write strategy is `'hash'`. Use the `@earth-app/collegedb` helpers (`run`, `first`, `firstByLookupKey`, `allAllShardsGlobal`) rather than raw Drizzle for anything that needs to be shard-aware. Routing keys are the row ID stringified (`String(nextId)`, the user `id`, etc.).

**Cache.** `cache(key, fetcher, ttl)` wraps reads through the NuxtHub `kv` binding. User CRUD invalidates `smoke:cache:user_id:<id>` and `smoke:cache:user_username:<username>` — keep that pattern when adding new entity caches. Cache keys for lists are `smoke:cache:<entity>:list:<search>:<page>:<limit>:<sort>:<dir>`.

**Blob storage.** NuxtHub blob (`hub:blob`, backed by the R2 `BLOB` binding) stores uploaded avatars at key `avatar/<userId>`. `user.avatar_url` is either an external `https` url or the sentinel `'local'` (meaning an uploaded blob). The `/api/users/[id]/avatar` GET/POST/DELETE handlers must share the `avatar/` key prefix. Avatars are set only through those endpoints — the user PATCH route rejects an `avatar_url` field.

**Sessions.** `ensureLoggedIn(event)` reads `Authorization: Bearer <token>`, hashes the token with SHA-256, and looks up two KV entries: `smoke:session_token_user:<hash>` (reverse index → userId) and `smoke:session_token_hash:<userId>:<hash>` (existence check). Max 5 active sessions per user; oldest are deleted when a new one is created. TTL is 14 days. `getOptionalLoggedIn(event)` is the no-throw variant.

**Authorization.** Role hierarchy is `Agent < Manager < Admin` (`src/shared/types/user.ts`). `Permission` is the granular check — always prefer `current.permissions.includes(Permission.X)` over role comparisons except in the `useAuth` composable. `Role.Admin` users get every permission via `DEFAULT_PERMISSIONS`. `ensureCanWriteTo(current, target)` is the gate for editing another user.

**User identifier resolution.** `getUserBy(value, event)` accepts `'current'` (logged-in user), `'@username'`, or a raw id — used by `/api/users/[id]/*` routes.

**Tickets.** `tickets.labels` and `tickets.assignees` are stored as comma-separated strings (see `parseCsvStringList` / `joinCsvNumberList`). `private` is stored as `0|1` integer. Messages and attachments are encrypted as parallel arrays — `messages[i]` pairs with `attachments[i]` (use `writeTicketSections` to keep them in sync). Private tickets are gated by `canViewPrivateTicket` (`ViewPrivateTickets`/`ManageTicket`/`ManageTicketMessages` perms or being an assignee).

**Email engine (`src/server/utils/email.ts` + `src/server/plugins/email.ts`).** Inbound mail (Cloudflare Email Routing → `cloudflare:email` hook) is parsed from the real `ForwardableEmailMessage` (`message.from`/`.to`/`.headers`/`.raw`, parsed with `postal-mime`), threaded into an existing ticket or used to open a new one, then answered with **one** synchronous `message.reply()` auto-ack (built with `mimetext`). Agent replies posted to `/api/tickets/[id]/messages` are mirrored to the customer via **Cloudflare Email Service** — `edgeport/smtp` `send()` to `smtp.mx.cloudflare.net:465` (implicit TLS, auth `api_token` / `CF_EMAIL_TOKEN`) — when the ticket is a non-private email thread.

- **Two transports, by capability.** `message.reply()` (free, in-handler, DMARC-gated, once per inbound) handles the auto-ack + the "not configured" notice. **Email Service via edgeport** handles deferred agent replies — it sends to **any recipient** (no verified-destination requirement, no 200-address cap), so there is no provisioning/verification/recycling. The sender domain must be onboarded to Cloudflare Email Sending (DKIM/SPF); `CF_EMAIL_TOKEN` needs "Email Sending: Edit".
- **No DB schema changes** — all email state lives in KV: `smoke:email_thread:<ticketId>` (subject + customer email + last Message-ID + References chain) and `smoke:email_msgid:<sha256(messageId)>` → ticketId (inbound resolution index).
- **Threading resolution order:** reply alias `support+t<id>@…` (primary) → `In-Reply-To` → `References` chain. Outbound uses edgeport's structured `Mail`: `From: Support <SUPPORT_EMAIL>` + `Reply-To: <alias>` (so customer replies route straight back), `In-Reply-To`/`References` as verbatim `headers`, and the agent message's `attachments` forwarded (edgeport `multipart/mixed`). `mimetext` is now only used to build the `reply()` auto-ack / not-configured raw.
- `edgeport/smtp` is **lazy-imported** inside the send path so the `#server-utils` test barrel doesn't pull `cloudflare:sockets` into every spec; tests `vi.mock('edgeport/smtp')`. Requires edgeport ≥ 1.0.1 (the `attachments` field).

## Conventions

- Comments: all lowercase, one line, no trailing period, minimal and tight — e.g. `// proxy external urls; "local" means an uploaded blob`, not a full sentence. Explain intent, not the obvious.
- Prettier: tabs, single quotes, no semicolons trailing, 100-col print width, `singleAttributePerLine`. Import order is managed by `prettier-plugin-organize-imports` — don't reorder by hand.
- Auto-imports: `src/server/utils/` (Nitro, server-only), `src/utils/` (app), and `src/shared/utils/` (both) are all auto-imported — don't write explicit `import` statements for their exports in routes/stores/composables. Server bindings come from the `hub:*` aliases (`hub:db`, `hub:kv`, `hub:blob`, `hub:db:schema`). Never import `~/server/*` from app/store/composable code — it pulls server-only deps into the client bundle.
- Throw `createError({ statusCode, message, data? })` for HTTP errors — server utilities and route handlers both rely on this h3 shape.
- Cloudflare env access via `event.context.cloudflare.env`; pass it down as `env: any` (existing typing convention in `utils.ts`).
- `compatibilityDate` for Nuxt is `2025-12-13`; the test wrangler config uses `2026-05-18` — bump both together when updating.
