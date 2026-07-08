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

- 📨 **Email-Native Tickets** - inbound mail (via Cloudflare Email Routing) opens or threads tickets
  automatically, with a synchronous auto-acknowledgement and per-ticket reply aliases.
- 🔁 **Two-Way Agent Bridge** - forward a ticket to an agent's own mailbox; they can reply from their
  email client (attributed back to their account) **or** from the UI. Replies can go out as the agent
  (name + avatar) or as an anonymous "Team" identity, per message.
- 🌐 **Public Portal** - a landing page, a Turnstile-ready ticket submission form, and a tokenized
  status page so customers can track their request without an account.
- 🧑‍💼 **Role-Aware Dashboard** - tickets, customers, labels, users, settings, and analytics, gated by
  a granular permission model (`Agent` < `Manager` < `Admin`).
- 📤 **Provider-Agnostic Email** - use **Cloudflare Email Service** with zero config, or point at **any
  custom SMTP** server (SES, Mailgun, Postmark, a self-hosted relay). Credentials are sealed at rest.
- 📥 **Optional IMAP/POP3 Polling** - not on Cloudflare Email Routing? Enable a scheduled poll that
  pulls new mail from any mailbox and threads it into tickets.
- ☁️ **Drop-In Cloudflare Setup** - the wizard links your account with an API token, then enables
  Email Routing, wires the catch-all email worker, registers the destination address, and surfaces the
  exact DKIM/SPF DNS records (creating them for you when the token allows).
- 🔐 **Envelope Encryption** - every PII payload is sealed with a per-row AES-256-GCM key wrapped by a
  key derived from your `MASTER_KEY`; emails are HMAC-indexed so they can be looked up without being
  stored in the clear.
- 📊 **Analytics** - ticket volume over time, open vs resolved, response/resolution times, breakdowns
  by status/priority/label, per-agent load, and email-channel share, all computed from your own data.
- 🌓 **Light/Dark Mode**, SEO, sitemap, robots, and i18n out of the box.

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
| `NUXT_PUBLIC_SITE_URL`                                                           | —        | Public site URL used in the auto-ack ticket link.                                                                                                                                                                                                      |
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

1. **Admin Account** - creates the first `Admin` user and logs you in.
2. **Email Channel** - pick **Cloudflare Email Service** (just enter your support address; uses
   `CF_API_TOKEN`) or **Custom SMTP** (host/port/TLS/user/password/from). The SMTP password is sealed.
3. **Branding** - optional site name/description/theme.
4. **Finish** - you land on the dashboard.

After setup, open **Settings → Cloudflare** to link your account (API token + account ID) and click
**Provision**: smoke enables Email Routing, wires the catch-all email worker, registers the
destination address, and shows any DNS records still needed. Then point your support domain's
catch-all Email Routing rule at this worker and you are receiving tickets.

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
  derived from `MASTER_KEY`; algorithm/nonce/tag/version stored per row.
- **Sharding** (`src/server/db/schema.ts`) - CollegeDB spreads rows across the `DB*` D1 bindings;
  `ensureCollegeDB(env)` runs before any query.
- **KV-only settings + email state** - global settings, sealed secrets, email threads, message-id and
  agent-mailbox indexes all live in KV (no schema changes needed to configure anything).
- **Email engine** (`src/server/utils/email.ts`, `email-poll.ts`, `src/server/plugins/email.ts`).
- **Cloudflare provisioning** (`src/server/utils/cloudflare.ts`) - token verification, zone discovery,
  Email Routing enable, catch-all-to-worker, DNS record creation.

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
