# PayPal integration

Reference: [Invoicing API v2](https://developer.paypal.com/docs/api/invoicing/v2/), [Webhooks](https://developer.paypal.com/api/rest/webhooks/).

## Configuration

```
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_WEBHOOK_ID=...
```

All calls are server-side (`src/lib/paypal/client.ts`, imported only from server code). Credentials are read from environment variables and never stored in the database or sent to the browser.

## Endpoints used

| Operation | Endpoint | Where |
|---|---|---|
| OAuth token (cached until 60 s before expiry, concurrent requests share one fetch) | `POST /v1/oauth2/token` | `PayPalClient.accessToken` |
| Create draft invoice | `POST /v2/invoicing/invoices` (`Prefer: return=representation`) | `createDraftInvoice` |
| Send invoice | `POST /v2/invoicing/invoices/{id}/send` | `sendInvoice` |
| Reminder | `POST /v2/invoicing/invoices/{id}/remind` | `remindInvoice` |
| Cancel sent invoice | `POST /v2/invoicing/invoices/{id}/cancel` | `cancelInvoice` |
| Get invoice (canonical state) | `GET /v2/invoicing/invoices/{id}` | `getInvoice` |
| List invoices (connection test) | `GET /v2/invoicing/invoices?page=&page_size=&total_required=true` | `listInvoices` |
| Verify webhook | `POST /v1/notifications/verify-webhook-signature` | `verifyWebhookSignature` |

## Send flow

1. Map the local draft to PayPal's payload (`detail.invoice_number`, `invoice_date`, `currency_code`, `payment_term.due_date`, `primary_recipients[].billing_info`, `items[]` with `unit_amount`, optional `tax`).
2. Create the PayPal draft with `PayPal-Request-Id: ciq-create-<invoice id>` and store the PayPal invoice ID immediately (separate column from the internal UUID). If the send then fails, a retry reuses the stored ID instead of creating a duplicate.
3. Send with `PayPal-Request-Id: ciq-send-<invoice id>`.
4. Re-read the invoice to capture status and `recipient_view_url` / `invoicer_view_url`.
5. Only now is the local status set to Sent. Any PayPal error leaves the invoice as a draft and is logged with PayPal's `debug_id`.

A successful send never implies payment. Payment status comes only from PayPal's invoice record.

## Idempotency

`PayPal-Request-Id` is set on every POST: create (`ciq-create-<invoice>`), send (`ciq-send-<invoice>`), remind (`ciq-remind-<task>`), cancel (`ciq-cancel-<invoice>`). A retried reminder for the same policy step reuses the same task and therefore the same request ID.

## Canonical status mapping (`mapper.ts`)

| PayPal status | Local status |
|---|---|
| `PAID`, `MARKED_AS_PAID`, `PARTIALLY_PAID` | `paid` **only if `due_amount` is 0**, otherwise `partially_paid` |
| `CANCELLED` | `cancelled` (balance 0) |
| `REFUNDED`, `PARTIALLY_REFUNDED`, `MARKED_AS_REFUNDED` | `refunded` |
| `UNPAID` | `unpaid` |
| `SENT`, `SCHEDULED`, `PAYMENT_PENDING` | `sent` |
| `DRAFT` | `draft` |

`overdue` is derived at read time from due date and balance.

## Webhooks (`/api/webhooks/paypal`)

1. Reject if PayPal or `PAYPAL_WEBHOOK_ID` is not configured (503).
2. Verify the signature with `verify-webhook-signature` using the `paypal-auth-algo`, `paypal-cert-url`, `paypal-transmission-id`, `paypal-transmission-sig`, `paypal-transmission-time` headers. Missing headers fail closed. Verification errors return 503 so PayPal retries.
3. Persist the raw event in `webhook_events` (unique `paypal_event_id`). A second delivery of a processed event returns 200 `duplicate` with no side effects. A previously failed event is re-processed.
4. Find the local invoice by `paypal_invoice_id`, fetch the canonical invoice from PayPal, update status/paid/due amounts, record `payment_received` or `payment_status_updated`.
5. If the invoice is paid, cancelled or refunded, pending reminder approvals expire and queued reminder tasks are suppressed.
6. Processing errors return 500 so PayPal retries.

Handled types: `INVOICING.INVOICE.CREATED`, `SENT`, `PAID`, `PARTIALLY_PAID`, `CANCELLED`, `REFUNDED`, `UPDATED`, `SCHEDULED`. Others are stored and ignored. Note that PayPal documents `INVOICING.INVOICE.PAID` as firing for paid, partially paid or pending payments, which is why the balance check matters.

## Demo gateway

When credentials are absent, `DemoPayPalGateway` stands in. It never contacts PayPal, returns `DEMO-INV-…` references, and every activity row records `mode = demo`. The "Simulate payment (demo)" button exists only for demo invoices and runs the same `applyCanonical` pipeline a verified webhook would.

## Limitations

- One PayPal merchant account per deployment (app-level credentials).
- Draft updates are kept local until send; PayPal `PUT` for drafts is not used.
- Multi-currency totals are not converted.
