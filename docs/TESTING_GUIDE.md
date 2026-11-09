# Testing guide

## Automated tests

```bash
npm test          # vitest run
npm run typecheck
npm run lint
npm run build
```

Tests run against the in-memory store and a `FakePayPal` gateway (`tests/helpers.ts`) that behaves like the sandbox: it keeps remote invoice state, honours `PayPal-Request-Id`, records every call and can inject failures. The PayPal HTTP client itself is tested against a mocked `fetch`.

| File | Covers |
|---|---|
| `invoices.test.ts` | Invoice creation and totals, tax, draft editing, validation, unknown/foreign clients, PayPal send, send failure without false success, retry without duplicate PayPal invoice, agent send needs approval, duplicate manual reminders, paid-invoice suppression, reminder API failure, cancellation |
| `intent.test.ts` | AI intent extraction for every example instruction, amount/due parsing, missing client, missing amount, ambiguous pause |
| `permissions.test.ts` | Money movement always denied, policy-driven allow, assisted/auto-execute/step approvals, escalations, closed/disputed/paused invoices, approval can't override deny, agent pause, chat writes |
| `policy-engine.test.ts` | Reminder eligibility by date, latest-step-only, closed invoices, paused policy, duplicate step prevention, failed-step retry, min gap, max reminders |
| `scheduler.test.ts` | Scheduler execution, no duplicates across runs, PayPal status fetched before reminding, escalation approval then execution, assisted mode, paid suppression, dispute block logged once, agent paused, failure + idempotent retry, full ladder over time |
| `webhooks.test.ts` | Signature failure rejected, verification error → 503, malformed body, PAID event with balance → partially paid, full payment suppresses pending reminders, duplicate deliveries, failed processing → 500 then retry, cancellation, unknown invoice/event |
| `paypal-client.test.ts` | Token caching, request headers and idempotency ids, link-only create response, API error mapping with debug id, auth/network failures, webhook verification request and fail-closed, canonical status mapping |
| `lifecycle.test.ts` | Complete lifecycle: chat request → approval → draft → approved PayPal send → autopilot reminder → verified webhook payment → no more reminders → audit trail; AI refusals; rejected approvals |

## Manual checks (demo mode)

1. `npm run dev`, open http://localhost:3000. The yellow banner confirms demo mode.
2. **AI Command Center**: "Create an invoice for Sarah for $850 for branding work, due in seven days" → Approve → Open invoice.
3. **Invoice**: Send via PayPal → dialog says it is simulated → status Sent, badge "Demo · not PayPal", reference `DEMO-INV-…`.
4. **Autopilot**: Run collection cycle now → reminders sent for eligible demo invoices, one escalation in the approval queue, one manual review.
5. **Agent Activity**: filter Approval required / Successful; every entry shows trigger, reasoning and permission check.
6. **Invoice → Simulate payment (demo)** → status Paid, pending approvals for it expire, next cycle skips it.
7. **Clients → Record dispute** → next cycle logs "Blocked".
8. **Settings → Pause all agent activity** → cycle blocks everything.

## Manual checks (PayPal Sandbox)

1. Configure PayPal env vars; Settings → **Test PayPal connection** shows the sandbox invoice count.
2. Create a client whose email is a sandbox personal account. Create and send an invoice; confirm it appears in the sandbox merchant account with the same PayPal invoice ID.
3. Send a reminder; check the activity row's PayPal reference.
4. Pay the invoice from the client payment link as the sandbox buyer. With the webhook configured (tunnel for localhost), the invoice flips to Paid; without it, press **Refresh from PayPal**.
5. Trigger the scheduler: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/run-collections`.
