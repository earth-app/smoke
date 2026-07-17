# 💨 smoke

> A self-hostable, serverless customer support platform, powered by Nuxt UI v4 and Cloudflare Workers.

smoke turns a Cloudflare account into a full support desk: customers email you or submit a request
from a public portal, tickets thread automatically, and your team replies from a rich dashboard **or
straight from their own email inbox**. Every piece of PII is envelope-encrypted, all state lives in
D1 + KV + R2, and a drop-in setup wizard links your Cloudflare account and provisions Email Routing
for you, so there is little to no dashboard clicking to get running. 🚀

<p align="center">
  <img alt="Nuxt 4" src="https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&logoColor=white" />
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" />
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue" />
</p>

---

<!-- add a dashboard screenshot here: /.github/screenshot.png -->

![Screenshot of smoke](/.github/screenshot.png)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/earth-app/smoke)

## ✨ Features

### 🎫 Tickets & Conversations

- 📨 **Email-Native Tickets** - inbound mail (Cloudflare Email Routing **or** an IMAP/POP3 poll) opens
  or threads tickets automatically, with a synchronous auto-acknowledgement and per-ticket reply
  aliases (`support+t<id>@<domain>`).
- 💬 **Unified Conversation View** - the same rich thread on the public status page and the dashboard:
  markdown, attachments, link previews, per-message edit history with before/after diffs, and a
  GitHub-issue-style **event timeline** (status/priority/label/assignee/visibility/deadline changes,
  with "by \<flow\>" attribution for automated ones).
- 🏷️ **Labels, Projects & Custom Fields** - GitHub-style labels with inline create + color editing,
  multi-project membership, and typed custom fields (text, select, multiselect, account, ticket,
  customer, label, file).
- 👁️ **Visibility, Locking & Retention** - per-ticket Public / Internal / Private visibility, thread
  locking, auto-archive of aged closed tickets, and an opt-in purge - all policy-driven from Settings.
- 🎨 **Ticket Identity** - a per-ticket icon + color, with status/priority/visibility dropdowns that
  carry icons, colored chips, and descriptions.

### 📮 Email

- 🔁 **Two-Way Agent Bridge** - forward a ticket to an agent's own mailbox; they can reply from their
  email client (attributed back to their account) **or** from the UI. Replies can go out as the agent
  (name + avatar) or as an anonymous "Team" identity, per message.
- 📤 **Provider-Agnostic Outbound** - use **Cloudflare Email Service** with zero config, or point at
  **any custom SMTP** server (SES, Mailgun, Postmark, a self-hosted relay). Credentials are sealed at
  rest. (Workers can't SMTP to Cloudflare's own relay, so Cloudflare sending uses its REST API.)
- 📥 **Optional IMAP/POP3 Polling** - not on Cloudflare Email Routing? Enable a scheduled poll that
  pulls new mail from any mailbox and threads it into tickets.
- 👥 **Participants** - CC or forward extra addresses onto a ticket and they gain portal view + reply
  access, even on a private ticket (privacy gates the anonymous public view, not the conversation).
- 🔔 **Event Notifications** - the customer, assigned agents, and participants are emailed on new
  messages and on any state change (opened/closed/reopened/archived/status), with a global opt-out.

### ⚡ Automation & AI

- 🧩 **Flows** - no-code automation: triggers (ticket / customer / label / assignee / agent lifecycle),
  comparison operators, and nested all/any condition trees drive actions - set status/priority/labels,
  assign, lock, draft or send a reply, or email the customer, with `{{placeholder}}` templating.
- 🤖 **AI Replies** - owner-enabled Cloudflare Workers AI drafts or auto-sends replies (reuses the
  linked account, off by default, hidden base prompt + a transparency trailer).

### 🧑 Customers & Portal

- 🌐 **Public Portal** - a landing page, a Turnstile-ready submission form, a tokenized status page,
  and a passwordless **email-OTP customer session**. Staff can create customers manually and mint
  reusable **magic access links**.

### 🛡️ Admin & Security

- 🧑‍💼 **Role-Aware Dashboard** - tickets, customers, labels, users, projects, audit, settings, and
  analytics, gated by a granular permission model (`Agent` < `Manager` < `Admin`) with a locked owner.
- 🧭 **Command Palette & Context Menus** - a global Cmd/Ctrl+K palette plus right-click menus on rows,
  cards, and the page background - all identity-gated.
- 🧑‍🔧 **Agent Onboarding & Recovery** - manager/owner-issued invite links (TTL + max-uses) and an
  OTP-based forgot-password flow.
- 📝 **Audit Log** - a non-PII audit trail across every mutation, filterable and exportable
  (CSV / JSON / TXT), with its own retention policy.
- 🔐 **Envelope Encryption** - every PII payload is sealed with a per-row AES-256-GCM key wrapped by a
  key derived from your `MASTER_KEY`; emails are HMAC-indexed so they can be looked up without being
  stored in the clear.
- 🛂 **Turnstile Bot Protection** - drop in a Cloudflare Turnstile site/secret key to guard the public
  submission form.

### 🎨 Branding & Deliverability

- 🖼️ **BIMI Brand Logo** - turn an Iconify icon into a BIMI-compliant SVG (SVG Tiny P/S), served at a
  stable URL, and auto-provision the `default._bimi` DNS record (with a DMARC-enforcement check, and an
  optional VMC link) through your Cloudflare token - a live-preview color/background/stroke customizer
  with transparency support lives in Branding.
- 🎭 **Branding & Avatars** - instance name / description / theme color, a favicon (Iconify icon,
  upload, or URL), per-role default avatar icons + colors, and social links.

### 🛠️ Platform

- ☁️ **Drop-In Cloudflare Setup** - the wizard links your account with an API token, then enables Email
  Routing, wires the catch-all email worker, registers the destination address, and surfaces (or
  creates) the exact DKIM / SPF / MX DNS records.
- 📊 **Analytics** - ticket volume over time, open vs resolved, response/resolution times, breakdowns
  by status/priority/label, per-agent load, and email-channel share, all computed from your own data.
- ⚡ **Fast Cold Starts** - a two-tier (in-isolate memory + KV) read-through cache, a KV-gated schema
  bootstrap that skips redundant DDL on warm deploys, and deterministic shard routing.
- 🌓 **Light/Dark Mode**, SEO, schema.org, sitemap, robots, and i18n out of the box.

## 🧱 Tech Stack

- [Nuxt 4](https://nuxt.com/) + [Nuxt UI v4](https://ui.nuxt.com/)
- [NuxtHub](https://hub.nuxt.com/) on Cloudflare Workers
- Cloudflare D1 (sharded via [CollegeDB](https://github.com/earth-app/CollegeDB), Drizzle ORM), KV, R2
- [edgeport](https://github.com/gmitch215/edgeport) - Workers-native SMTP/IMAP/POP3 (the mail transport)
- [postal-mime](https://github.com/postalsys/postal-mime) + [mimetext](https://github.com/muratgozel/MIMEText) for parsing/building mail
- [Pinia](https://pinia.vuejs.org/) stores, [Zod](https://zod.dev/) validation, [Turnstile](https://www.cloudflare.com/products/turnstile/)
- [Playwright](https://playwright.dev/) E2E (monocart coverage) + [Vitest](https://vitest.dev/) unit tests (GreenMail integration)

## ⚙️ Configuration (Environment Variables)

Only two secrets are required to boot; everything email/Cloudflare-related can be set later from the
setup wizard or the Settings page (no redeploy needed).

| Variable                                                                         | Required | Purpose                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MASTER_KEY`                                                                     | ✅       | >= 16 chars. Envelope-encrypts all PII. Deploy-time secret (gates the database).                                                                                                                                                                       |
| `HMAC_SECRET`                                                                    | ✅       | Hex, >= 32 bytes (`openssl rand -hex 32`). HMACs emails for lookup. Deploy-time secret.                                                                                                                                                                |
| `CF_API_TOKEN`                                                                   | ⛅       | Cloudflare API token. Used as the SMTP password for Cloudflare Email Service **and** for account linking / Email Routing + Worker provisioning. Can be set in the wizard instead. _(renamed from `CF_EMAIL_TOKEN`, which is still read as a fallback)_ |
| `SUPPORT_EMAIL`                                                                  | ⛅       | Base support address; reply aliases are `support+t<id>@<domain>`. Set in the wizard if omitted.                                                                                                                                                        |
| `NUXT_PUBLIC_SITE_URL`                                                           | —        | Public site URL used in the auto-ack ticket link and as the BIMI logo host.                                                                                                                                                                            |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_TLS` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | —        | Override the outbound transport (any SMTP server). Primarily for tests/self-hosting; the Settings UI is the normal path.                                                                                                                               |

> **Port note:** smoke runs on **port 4000** by default (an explicit pivot away from the Workers `8787`
> / occasional `3000`). Dev, e2e, and preview all use `4000`; the isolated setup-test server uses `4001`.

See [`.env.test`](.env.test) for example values.

## 🚀 Quick Start

```sh
bun install
bun run dev            # http://127.0.0.1:4000
```

On first load you are redirected to **`/setup`**. The wizard:

1. **Admin Account** - creates the first `Admin` user (with an optional avatar + PBKDF2 iteration
   count) and logs you in.
2. **Email Channel** - pick **Cloudflare Email Service** (just enter your support address; uses
   `CF_API_TOKEN`) or **Custom SMTP** (host/port/TLS/user/password/from), plus an optional inbound
   receiving choice (Cloudflare Routing or an IMAP/POP3 mailbox). The SMTP password is sealed.
3. **Cloudflare** - optionally link your account and provision Email Routing + the inbound worker
   inline (skippable; also available later in Settings).
4. **Branding** - optional site name / description / theme color / favicon.
5. **Finish** - you land on the dashboard.

Everything email- and Cloudflare-related is **KV-overridable with an env fallback**, so you can also
configure it later. Open **Settings → Cloudflare** to link your account (API token + account ID) and
**Provision**: smoke enables Email Routing, wires the catch-all email worker, registers the
destination address, onboards **Cloudflare Email Sending** (DKIM/SPF), and can publish a **BIMI**
brand-logo record - each surfacing the exact DNS records (and creating them when the token allows).
Point your support domain's catch-all Email Routing rule at this worker and you are receiving tickets.

## 📮 How Email Flows

- **Inbound**: Cloudflare Email Routing delivers to the worker → parsed → threaded into an existing
  ticket (by reply alias, then `In-Reply-To`/`References`) or a new one → one auto-ack reply.
- **Outbound**: agent replies posted in the UI (or from a linked mailbox) are mirrored to the customer
  through the resolved transport (Cloudflare Email Service or your custom SMTP), threaded with the
  right `Reply-To`/`In-Reply-To` headers and any attachments.
- **Agent bridge**: assigned agents get a forwarded copy in their own inbox; replying there is ingested
  back into the thread and attributed to their account (matched by sender address).
- **No Cloudflare Routing?** Enable the IMAP/POP3 poll in Settings; a scheduled task pulls new mail.

## 🧪 Testing

```sh
bun run test               # vitest unit tests (Cloudflare Workers pool)
bun run test:coverage      # unit coverage (istanbul)
bun run test:e2e           # Playwright (desktop + mobile) against a prod build/preview
bun run test:e2e:setup     # the isolated first-run setup flow (fresh server on 4001)

# email round-trip integration (needs Docker; GreenMail SMTP/IMAP/POP3)
docker compose -f docker/compose.yml up -d --wait
bun run test:integration
docker compose -f docker/compose.yml down -v
```

The integration lane sends a real message through the outbound transport into GreenMail and reads it
back over IMAP with `edgeport`, asserting the ticket/KV mutations, headers, and attachments.

## 🏗️ Architecture

- **Envelope encryption** (`src/server/utils/encryption.ts`) - per-row AES-256-GCM DEK wrapped by a KEK
  derived from `MASTER_KEY`; algorithm/nonce/tag/version stored per row (Workers caps PBKDF2 at 100k,
  so iterations are configurable + versioned per row).
- **Sharding** (`src/server/db/schema.ts`) - CollegeDB spreads rows across the `DB*` D1 bindings;
  `ensureCollegeDB(env)` runs before any query, and a KV `schema_ready` flag skips redundant DDL on
  warm deploys.
- **KV-only settings + email state** - global settings, sealed secrets, email threads, message-id,
  agent-mailbox, and participation indexes all live in KV (no schema changes needed to configure
  anything).
- **Two-tier cache** (`src/server/utils/cache.ts`) - an in-isolate memory `Map` (L1) over the KV
  binding (L2) with centralized keys + invalidators; hot paths (settings, current user, ticket lists)
  read through it.
- **Email engine** (`src/server/utils/email.ts`, `email-poll.ts`, `src/server/plugins/email.ts`).
- **Cloudflare provisioning** (`src/server/utils/cloudflare.ts`) - token verification, zone discovery,
  Email Routing enable, catch-all-to-worker, Email Sending onboarding, BIMI + DMARC records, and DNS
  create/upsert.
- **BIMI** (`src/server/utils/bimi.ts`) - a pure Iconify-to-SVG-Tiny-P/S transform served at
  `/bimi/logo.svg`, paired with the `default._bimi` DNS provisioning above.
- **Audit + notifications** (`src/server/utils/audit.ts`, `notifications.ts`) - a non-PII audit trail
  and best-effort email notifications on ticket events, both hooked into the mutation paths.

## 🚢 Deployment

```sh
bun run build
npx wrangler --cwd .output deploy
```

Set `MASTER_KEY` and `HMAC_SECRET` as Worker secrets (`wrangler secret put`). Everything else is
configurable from the app. A cron trigger (`*/15 * * * *`) runs the optional inbound poll; it no-ops
unless you enable a mailbox in Settings.

## 📄 License

[MIT](LICENSE)

## 📝 Contributing

Contributions are welcome! Please open an issue or submit a PR.

Made with ❤️ by [Gregory Mitchell](https://github.com/gmitch215) at [The Earth App](https://earth-app.com).
