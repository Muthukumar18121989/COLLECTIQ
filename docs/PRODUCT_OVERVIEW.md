# Product overview

## Problem

Freelancers do the work, then become unpaid debt collectors. Around 29% of freelance invoices are paid late, and freelancers spend more than a workday a month chasing payments (see the sources in `PRODUCT_DESIGN.md`). Chasing is emotionally costly, reminders are generic, and there is no early warning about cash flow.

## Persona

An independent UX/UI designer with 5 to 12 active clients, invoices of $300 to $4,000, already paid through PayPal.

## Product

COLLECTIQ is an **autonomous AI financial operations agent** for the invoice-to-payment lifecycle:

1. **Bill**: "Create an invoice for Sarah for $850 for branding work, due in seven days" becomes a validated draft for an existing client, which you approve, preview and send through PayPal.
2. **Watch**: verified PayPal webhooks update invoice status. The agent never trusts an event payload alone; it re-reads the canonical invoice from PayPal and checks the outstanding balance.
3. **Chase**: a policy engine runs a reminder ladder (default: friendly 3 days before due, follow-up 1 day overdue, escalation at 7 days, manual review at 14). Low-risk reminders run automatically in Policy-driven mode; escalations wait for approval.
4. **Explain**: every action is logged with the trigger, the observed condition, the reasoning, the permission decision and the PayPal reference.

## Principles in practice

| Principle | How it shows up |
|---|---|
| AI-first, not chatbot-only | The same tool layer powers chat, the scheduler and approvals. |
| PayPal central | Invoices are created, sent, reminded, cancelled and read through the PayPal Invoicing v2 API; payment state comes from PayPal. |
| Human approval for sensitive actions | Sends, cancellations, escalations and chat-initiated writes are approval cards. |
| Autonomy within permissions | Three autonomy modes, per-policy auto-execute, per-step approval, global pause. |
| Transparency | Agent Activity log and per-invoice timeline. |
| Never invent | Tools return only stored records; demo data is labelled; expected income is labelled "by due date, not confirmed". |
| Auditable | Append-only `agent_activity` table (no update/delete policy in RLS). |

## Autonomy modes

- **Assisted**: the agent prepares every action; you approve each one.
- **Policy-driven** (default): low-risk reminders your active policy explicitly allows run automatically; escalations and sensitive actions need approval.
- **Adaptive**: Policy-driven, plus history-based policy recommendations (e.g. add an earlier reminder when most invoices are paid late). Recommendations are approval cards.

## Out of scope for the MVP

COLLECTIQ never sends payments, issues refunds or changes payment amounts. Split payment plans and Pay Later offers from the earlier "Settled" design are future work.
