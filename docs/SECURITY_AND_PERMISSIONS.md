# Security and permissions

## Permission service

`checkPermission()` in `src/lib/agent/permissions.ts` is a pure function evaluated on every operation, independently of AI output, both when an action is proposed and again at execution time (after the latest PayPal status is fetched).

Decisions: `allow`, `require_approval`, `deny`. Human approval upgrades `require_approval` to `allow` but **never overrides a deny**.

| Rule | Decision |
|---|---|
| Send payment, issue refund, modify payment amount | deny, always |
| Any agent/scheduler action while the agent is paused | deny |
| Reminder/escalation on paid, cancelled, refunded, draft or zero-balance invoice | deny |
| Dispute or client objection recorded | deny for everyone |
| Collection paused for invoice or client | deny for agent/scheduler |
| Policy paused or missing (scheduler) | deny |
| Escalation | require approval |
| Policy step marked "requires approval" | require approval |
| Assisted mode | require approval |
| Policy auto-execute off | require approval |
| Chat-initiated writes (create, send, remind, cancel, pause) | require approval |
| Low-risk reminder allowed by an active auto-execute policy in Policy-driven/Adaptive mode | allow |
| Direct user actions (button clicks) | allow (subject to the hard denies) |

## Duplicate prevention and safe retries

- `agent_tasks.idempotency_key` is unique: one task per invoice per policy step; one manual reminder per invoice per day.
- Failed tasks are retried with the same task id, therefore the same `PayPal-Request-Id`.
- Approvals are claimed (`pending → approved`) before execution so double clicks cannot execute twice.
- Webhook events are unique by PayPal event id.
- PayPal IDs are persisted right after creation so a failed send never creates a second PayPal invoice.

## Secrets

- Read only in `src/lib/env.ts` (`server-only`). PayPal secret, Supabase service role key, Anthropic key and cron secret never reach client bundles or the database.
- The logger redacts keys matching secret/token/authorization/password/api_key.
- Settings shows whether integrations are configured, never the values.

## Authentication and authorization

- Supabase Auth (email + password). `src/proxy.ts` refreshes the session and redirects signed-out users to `/login`.
- Every API route goes through `apiRoute()`, which requires a session.
- Data access goes through `UserDb`, which scopes reads and stamps writes with the user id, on top of Postgres RLS.
- The cron endpoint requires `Authorization: Bearer $CRON_SECRET` (constant-time comparison) and is disabled when the secret is unset.
- The webhook endpoint accepts nothing without a successful PayPal signature verification.

## Input validation and abuse controls

- Zod schemas for every request body (`src/lib/validation.ts`); money limited to 2 decimals and ≤ 1,000,000.
- Rate limits: AI chat 20/min/user, insights 6/min, autopilot runs 6/min, login 10/min/IP, signup 5/min/IP.
- Webhook bodies limited to 512 KB.
- Security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`.
- Chat output is rendered with a minimal formatter that never injects HTML.

## Error handling

- `ServiceError` for expected failures (validation, permission, PayPal) with friendly messages and HTTP codes; unexpected errors return a generic message and are logged.
- PayPal errors carry status, issue and `debug_id`, shown in the activity log.
- Route-level error boundary, loading and not-found states.

## Audit

`agent_activity` is append-only under RLS and records trigger, observed condition, reasoning, proposed action, permission result, approval status, execution status, PayPal reference, errors and whether the action was demo, sandbox or live.
