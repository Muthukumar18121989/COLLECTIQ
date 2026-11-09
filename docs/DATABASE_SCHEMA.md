# Database schema

Migration: `supabase/migrations/20261109000000_initial_schema.sql`. All tables have UUID primary keys, `created_at` / `updated_at` (trigger-maintained), and `user_id` ownership with Row Level Security. Money is stored as integer cents (`bigint`).

| Table | Purpose | Notable columns / constraints |
|---|---|---|
| `profiles` | One row per Supabase auth user | `autonomy_mode` check (assisted, policy_driven, adaptive), `agent_paused`, `default_currency`, `tax_rate_percent` |
| `clients` | Billed customers | unique `(user_id, lower(email))`, `collection_paused`, `dispute_open`, `dispute_note`, `is_demo` |
| `projects` | Client projects | FK client, status check |
| `invoices` | Invoices | unique `(user_id, invoice_number)`; status check (draft, sent, unpaid, partially_paid, paid, overdue, cancelled, refunded); `due_date >= issue_date`; PayPal fields kept separate: `paypal_invoice_id` (unique when set), `paypal_mode`, `paypal_status`, `paypal_recipient_url`, `paypal_invoicer_url`, `paypal_last_synced_at` |
| `invoice_items` | Line items | `quantity > 0`, `unit_amount_cents >= 0`, `position` |
| `collection_policies` | Reminder ladders | `steps jsonb`, `auto_execute`, `max_reminders_per_invoice` (1–10), `min_days_between_reminders` (1–30), one default per user (partial unique index) |
| `agent_tasks` | Each scheduled/executed collection action | **unique `idempotency_key`** (e.g. `invoice:<id>:step:overdue_1`), status check, `paypal_ref`, `error` |
| `approvals` | Human-in-the-loop queue | kind/status/source checks, `payload jsonb`, `result jsonb`, unique pending `idempotency_key` |
| `agent_activity` | Append-only audit log | trigger, observed_condition, reasoning, proposed_action, permission_result, approval_status, execution_status, paypal_ref, error, `mode` (sandbox/live/demo/internal) |
| `webhook_events` | Raw PayPal events | **unique `paypal_event_id`**, `verification_status`, `processing_status`, `payload jsonb` |
| `conversations`, `conversation_messages` | AI chat history | `tool_calls jsonb`, `approval_ids uuid[]` |

## Indexes

User/status/due-date on invoices, user/created on activity, invoice lookups on items, tasks and activity, resource id on webhook events.

## Row Level Security

- Every user table: select/insert/update/delete only where `user_id = auth.uid()` (`profiles`: `id = auth.uid()`).
- `agent_activity`: select and insert only (no update/delete): the audit log is append-only for users.
- `webhook_events`: users can read their own; inserts only for demo events (`verification_status = 'SKIPPED_DEMO'`). Real events are written by the server with the service role.

## Access pattern

- Page and API requests use the signed-in user's Supabase session, so RLS applies, and `UserDb` additionally filters by `user_id`.
- The scheduler and webhook handler use the service-role client (server-only) and always scope through `UserDb`.

## Demo data

`seedDemoData()` (src/lib/db/seed.ts) creates 5 fictional clients and 11 invoices relative to today, all `is_demo = true`, with sent invoices on `paypal_mode = 'demo'` and `DEMO-` references. In Supabase mode it can be loaded per account from Settings → Demo data.
