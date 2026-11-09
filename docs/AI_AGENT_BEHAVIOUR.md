# AI agent behaviour

## Engines

- **Claude** (`src/lib/agent/claude-agent.ts`) when `ANTHROPIC_API_KEY` is set. A tool-use loop of up to 8 steps with the last 12 messages of the conversation as context. Model from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`).
- **Demo AI** (`demo-agent.ts` + `intent.ts`) otherwise: deterministic intent extraction that calls the same tools. Labelled "Demo AI · rule-based" in the UI.

Both go through `executeTool()` in `tools.ts`, so validation and approvals are identical.

## Tools

| Tool | Type | Behaviour |
|---|---|---|
| `find_client` | read | Searches saved clients; says explicitly when none match. |
| `list_invoices` | read | Filters by status (incl. derived `overdue`, `open`), client, due window. |
| `retrieve_invoice` | read | By id or invoice number, with line items and PayPal ids. |
| `get_collection_summary` | read | Figures from `computeSummary()` plus a factual sentence; flags demo data. |
| `retrieve_agent_activity` | read | Recent audit entries. |
| `create_invoice_draft` | write → approval | Requires existing `client_id`, explicit positive amount and description; refuses a currency different from the client's; default due 14 days is called out. |
| `send_invoice` | write → approval | Drafts only. |
| `send_invoice_reminder` | write → approval | Refuses paid/cancelled/draft/disputed invoices. |
| `pause_collection_policy` | write → approval | Client or invoice. |

Write tools never execute: they create an `approvals` row and return `awaiting_user_approval`. The chat shows an approval card; **Approve** calls `/api/approvals/:id`, which runs the backend service with the permission check re-evaluated.

## Rules in the system prompt

- Never invent clients, invoices, amounts, dates, statuses or PayPal results.
- Look up clients first; ask the user to add a missing client instead of creating one.
- Ask a clarifying question when the client, amount or work description is missing.
- Say that write actions await approval; never claim success before a tool result confirms it.
- Never offer payments, refunds or amount changes.
- Mention demo data; describe expected income as due dates, not confirmed payments.

These rules are reinforced in code: the tool layer validates every input against stored records, and the permission service decides execution regardless of what the model says.

## Example conversations

| User | Behaviour |
|---|---|
| "Create an invoice for Sarah for $850 for branding work, due in seven days" | `find_client` → `create_invoice_draft` → approval card "Create draft invoice for Sarah Chen: Branding, $850.00, due 2026-11-16". |
| "Create an invoice for Priya for $500" (no such client) | Replies that no client called Priya is saved and asks to add them; no approval created. |
| "Show all overdue invoices" | `list_invoices(status=overdue)` and a list. |
| "Which client owes me the most money?" | `get_collection_summary` → top `by_client`. |
| "Prepare reminders for clients who haven't paid" | One reminder approval per eligible overdue invoice; skips paused/disputed ones. |
| "Pause reminders for Alex" | `pause_collection_policy` approval. |
| "Explain why my outstanding balance has increased" | Summary + month-by-month invoiced vs collected. |

## Insights briefing

`/api/ai/insights` passes only pre-computed figures to Claude with instructions not to compute or invent numbers. Without Claude (or on error) the deterministic `factualSummary()` is shown.

## Rate limiting and failures

20 chat requests per user per minute, 6 insight requests per minute. If Claude fails, the user is told nothing was changed and the error is logged.
