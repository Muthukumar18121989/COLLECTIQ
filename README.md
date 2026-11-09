# COLLECTIQ

**Do the work. Let your agent get you paid.**

COLLECTIQ is an autonomous AI accounts-receivable agent for freelancers, built on the **PayPal Invoicing API** and **Claude**. It creates invoices from plain-language requests, sends them through PayPal, watches payment status through verified PayPal webhooks, and runs a policy-driven collection autopilot, while a separate permission service decides what the AI may actually do.

Built for the PayPal AI Hackathon 2026.

## What it does

| Module | What you get |
|---|---|
| **Overview** | Outstanding, overdue, collected this month, due in 30 days, collection rate, aging, pending approvals, agent activity. All computed from stored invoices. |
| **AI Command Center** | Chat with Claude using tool calling (`find_client`, `create_invoice_draft`, `send_invoice`, `send_invoice_reminder`, …). Every write becomes an approval card; nothing executes until you approve it. |
| **Invoices** | AG Grid listing with search and status filters, manual create/edit/preview, send via PayPal, reminders, cancel, refresh from PayPal, activity timeline and collection history. |
| **Autopilot** | Configurable collection policies (reminder ladder, tone, frequency limits, auto-execute, approval rules), a scheduler endpoint for cron, and an approval queue. |
| **Clients** | Directory with invoiced/collected/outstanding/overdue, payment and communication history, pause reminders, record disputes. |
| **Agent Activity** | Audit log: trigger, observed condition, reasoning, proposed action, permission check, approval, execution status, PayPal reference, errors. |
| **Insights** | Monthly collections, aging, client contribution, upcoming due dates and an AI briefing grounded only in computed figures. |
| **Settings** | Autonomy mode (Assisted / Policy-driven / Adaptive), emergency agent pause, integration status and a live PayPal connection test. |

## Quick start (demo mode, no credentials needed)

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no environment variables set, COLLECTIQ runs in **demo mode**:

- A local JSON database (`.data/demo-db.json`) is seeded with fictional clients and invoices, all marked **Demo**.
- PayPal sends and reminders are **simulated and labelled "Demo · not PayPal"**. No PayPal call is made and no demo action is ever shown as a PayPal success.
- The AI Command Center uses a deterministic rule-based engine (labelled "Demo AI") that calls the same tools and approval flow as Claude.

A yellow banner at the top of every page shows which integrations are in demo mode.

## Going live with PayPal Sandbox, Supabase and Claude

1. `cp .env.example .env.local` and fill in the values below.
2. **PayPal Sandbox**: create a REST app at https://developer.paypal.com/dashboard/applications/sandbox. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`. In Settings, press **Test PayPal connection**.
3. **PayPal webhooks**: in the same app, add a webhook to `https://<your-host>/api/webhooks/paypal` for `INVOICING.INVOICE.CREATED`, `.SENT`, `.PAID`, `.PARTIALLY_PAID`, `.CANCELLED`, `.REFUNDED`, `.UPDATED` (and `.SCHEDULED`). Put its ID in `PAYPAL_WEBHOOK_ID`. For local testing expose your dev server with a tunnel (e.g. `ngrok http 3000`).
4. **Supabase**: create a project, run `supabase/migrations/20261109000000_initial_schema.sql` (SQL editor or `supabase db push`), then set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Users sign up on `/login`; demo data can be loaded per account from Settings.
5. **Claude**: set `ANTHROPIC_API_KEY` (optionally `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`).
6. **Scheduler**: set `CRON_SECRET` and call `POST /api/cron/run-collections` with `Authorization: Bearer $CRON_SECRET` on a schedule.

### Test credentials for judges

Sandbox buyer accounts are created in the PayPal developer dashboard under **Testing tools → Sandbox accounts**. To see a payment flow end-to-end: send an invoice to the sandbox **personal** account's email, open the client payment link shown on the invoice page, log in as that sandbox buyer and pay. The verified webhook flips the invoice to Paid and stops all reminders.

Sandbox accounts used for development (PayPal Sandbox only, no real money):

| Role | Sandbox account | Country |
|---|---|---|
| Freelancer / merchant (invoicer) | `sb-47sxld53787979@business.example.com` | US |
| Client / buyer (pays invoices) | `sb-4visu53811690@personal.example.com` | US |

> **Use a US (or other Invoicing-enabled) sandbox business account.** Apps linked to India-registered sandbox accounts receive no Invoicing scope and every Invoicing call returns `403 NOT_AUTHORIZED`. Also tick **Invoicing** under the app's Features in the developer dashboard.

Verified on 2026-11-09 against the PayPal Sandbox: connection test, invoice create + send (`INV2-QGDY-CTJX-47RJ-TL2B`, status `SENT`, recipient and invoicer URLs returned), reminder, canonical status refresh, and duplicate-reminder prevention.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Vitest suite (63 tests: lifecycle, policy engine, permissions, scheduler, webhooks, PayPal client, AI intent) |

## Deploying to Render

`render.yaml` defines a web service and an hourly cron job. Create a Blueprint from the repo, then fill in the secret environment variables in the Render dashboard (`APP_URL` on both services). See [docs/TECHNICAL_ARCHITECTURE.md](docs/TECHNICAL_ARCHITECTURE.md#deployment-on-render).

## Documentation

- [Product overview](docs/PRODUCT_OVERVIEW.md)
- [Technical architecture](docs/TECHNICAL_ARCHITECTURE.md)
- [PayPal integration](docs/PAYPAL_INTEGRATION.md)
- [AI agent behaviour](docs/AI_AGENT_BEHAVIOUR.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [Security and permissions](docs/SECURITY_AND_PERMISSIONS.md)
- [Testing guide](docs/TESTING_GUIDE.md)

Earlier design notes: [PRODUCT_DESIGN.md](PRODUCT_DESIGN.md) and the hackathon rules summary in [RULES_SUMMARY.md](RULES_SUMMARY.md).

## License

MIT, see [LICENSE](LICENSE).
