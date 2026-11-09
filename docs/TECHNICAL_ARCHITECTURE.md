# Technical architecture

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4 with shadcn-style components on Radix UI · Lucide icons · AG Grid Community (invoice grid) · Recharts · Supabase Postgres + Auth · Claude API (`@anthropic-ai/sdk`) · PayPal REST (Invoicing v2, Notifications) · Zod · Vitest.

## Layers

```
Browser (React client components)
  │  fetch → /api/*  (JSON, Zod-validated)
  ▼
Route handlers (src/app/api)          Server components (src/app/(app))
  │  apiRoute(): auth → handler → consistent errors
  ▼
Services (src/lib/services)            ← business rules, audit logging
  ├─ invoices.ts      create / edit / send / remind / cancel / sync / applyCanonical
  ├─ approvals.ts     create + decide (approve executes through services)
  ├─ collection.ts    pause / resume / disputes
  ├─ webhooks.ts      verify → persist → dedupe → canonical fetch → update
  └─ demo.ts          demo-only payment simulation
Agent (src/lib/agent)
  ├─ permissions.ts   pure permission service (independent of AI output)
  ├─ policy-engine.ts pure "what does the policy say next" evaluator
  ├─ scheduler.ts     collection cycle: engine → permissions → PayPal → log
  ├─ tools.ts         AI tool definitions + validated executors
  ├─ claude-agent.ts  Claude tool-use loop
  ├─ demo-agent.ts / intent.ts  deterministic fallback engine
  └─ adaptive.ts      history analysis → policy recommendations
PayPal (src/lib/paypal)
  ├─ client.ts        OAuth token cache, typed requests, PayPal-Request-Id, errors
  ├─ gateway.ts       Live vs Demo gateway behind one interface
  └─ mapper.ts        local ⇄ PayPal payloads, canonical status mapping
Data (src/lib/db)
  ├─ store.ts         small persistence interface
  ├─ supabase-store.ts / memory-store.ts
  └─ user-db.ts       user-scoped view: every read filtered, every write stamped
```

The responsibilities follow the spec's split:

- **Claude** understands context and prepares actions (tool calls that create approval requests).
- **The policy engine** evaluates what the policy says should happen for each invoice.
- **The scheduler** finds eligible invoices and drives the cycle.
- **The permission service** decides whether each operation may run, at proposal time and again at execution time.
- **PayPal** executes approved operations.
- **The database** records tasks, approvals and the activity log.

## Request flow: "remind this invoice"

1. `remindInvoice()` loads invoice, client, profile → `checkPermission()`.
2. Inserts an `agent_tasks` row with a unique idempotency key (duplicate → 409).
3. Fetches the canonical invoice from PayPal and applies it locally.
4. Re-checks permission against the fresh state (paid/cancelled → suppressed).
5. Calls `POST /v2/invoicing/invoices/{id}/remind` with `PayPal-Request-Id = ciq-remind-<task id>`.
6. Marks the task succeeded/failed and writes `agent_activity`.

## Modes

`integrationModes()` (src/lib/env.ts) inspects env vars:

| Integration | Configured | Missing |
|---|---|---|
| PayPal | `LivePayPalGateway` (sandbox or live base URL) | `DemoPayPalGateway`, every reference prefixed `DEMO-`, UI badge "Demo · not PayPal" |
| Supabase | `SupabaseStore` with the user's session (RLS) | `MemoryStore` persisted to `.data/demo-db.json`, single demo user |
| Claude | `runClaudeAgent` | `runDemoAgent` (rule-based, same tools) |

An invoice remembers which gateway it lives on (`paypal_mode`), so demo invoices never reach PayPal even after credentials are added, and PayPal invoices refuse to run without credentials.

## Rendering

Cache Components is disabled: every page reads per-user data. `getSession()` calls `connection()` so nothing is prerendered. Mutations happen through route handlers followed by `router.refresh()`.

## Deployment on Render

1. Push the repo to GitHub and create a **Blueprint** from `render.yaml` (web service + hourly cron job).
2. Set env vars on the web service: PayPal, Supabase, Anthropic, `APP_URL` (e.g. `https://collectiq.onrender.com`). `CRON_SECRET` is generated and shared with the cron job; set `APP_URL` on the cron job too.
3. Run the Supabase migration.
4. Add the PayPal webhook URL `https://<host>/api/webhooks/paypal` and set `PAYPAL_WEBHOOK_ID`.
5. Without Supabase, Render's disk is ephemeral, so demo data resets on each deploy (by design).

The in-process rate limiter assumes one instance; use a shared store (Redis) before scaling out.
