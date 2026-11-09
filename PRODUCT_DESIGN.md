# Settled: an AI agent that gets freelancers paid

PayPal AI Hackathon 2026 product design. Covers the problem, the outcome, the user flows and the full UX.

---

## 1. The problem

**Freelancers and micro-businesses do the work, then become unpaid debt collectors.**

A designer finishes a logo, sends an invoice and waits. A week passes. They feel awkward about sending a reminder, so they send a soft one late. The client forgets, or is short on cash this month, or the invoice is buried in an inbox. The freelancer can't pay rent on time, and the client relationship gets tense.

### Evidence

| Finding | Source |
|---|---|
| **29%** of freelance invoices are paid late (women: 31%, men: 24%) | Bonsai, 3 years of invoicing data from 100,000+ freelancers |
| **56%** of US small businesses have unpaid invoices, averaging **$17,500** owed. **47%** have invoices over 30 days overdue. | Intuit QuickBooks Small Business Late Payments Report 2025 (2,487 businesses) |
| Businesses with many late invoices: **50%** have cash-flow problems (vs 34% with few) | Same QuickBooks report |
| **42%** of freelancers have missed personal bills because of payment delays | Freelancers Union, as cited by Agiled |
| Freelancers spend **more than a full workday a month** chasing payments | Jobbers.io Global Freelance Client Payment Delay Report 2025 |
| **1 in 3** small business owners delayed paying themselves because customers paid late | Bluevine 2026 survey |
| Late or unpaid invoices cause **up to 25% of bankruptcies** | Allianz Trade |

Sources: [Clockify late-invoice statistics](https://clockify.me/late-invoice-statistics), [Agiled late-payment statistics](https://agiled.app/statistics/late-payment-statistics), [Flexable report](https://flexable.work/reports/freelancers-facing-payment-issues/). *Check the underlying reports before quoting numbers in the video.*

### Why it happens (root causes)

1. **Chasing is emotionally costly.** Freelancers delay or soften reminders because they fear losing the client.
2. **Reminders are dumb.** Existing tools send the same "your invoice is overdue" email on a fixed schedule, whoever the client is.
3. **Paying is friction.** The client has to find the invoice, log in and pay in one go. If cash is tight, the easiest thing is to do nothing.
4. **No early warning.** Freelancers find out a payment is late after it is late, with no forecast of what money lands when.

### Who it's for

**Primary persona: Priya, freelance brand designer.** 8 to 12 active clients, invoices $500 to $4,000, uses PayPal already. Hates "chasing" emails. Has missed a credit-card payment because two clients paid 3 weeks late in the same month.

**Secondary: the client (Mark, small agency owner).** Not a bad actor, just busy and juggling his own cash flow. Would pay faster if it were one tap, or if he could split it.

---

## 2. The outcome we bring

**Freelancers get paid on time without ever writing an awkward email.**

| Outcome | How Settled delivers it | Demo-able metric |
|---|---|---|
| Faster payment | Invoice goes out in seconds, every reminder is a one-tap PayPal checkout | Days-to-paid on the dashboard |
| No awkward chasing | The AI agent chases on the freelancer's behalf, in their voice, within rules they set | "Reminders sent for you: 14" |
| Fewer write-offs | When a client can't pay in full, the agent offers Pay Later or a split plan instead of silence | Recovered amount |
| No surprises | AI predicts which invoices will be late and forecasts cash for the next 30 days | Cash-flow forecast chart |

**The key insight:** the client's cash problem doesn't have to be the freelancer's cash problem. With PayPal Pay Later, the client can pay over time while the freelancer is paid in full now. Settled's agent is the thing that offers that option at the right moment.

---

## 3. Product concept

Settled is an **accounts-receivable agent** that sits on top of the freelancer's PayPal account. It does three jobs:

1. **Bill:** turns a sentence, an email thread or a contract PDF into a correct PayPal invoice.
2. **Chase:** watches every open invoice, decides when and how to follow up per client, and sends reminders with a pay link. Freelancer approves or sets it to autopilot.
3. **Resolve:** when a client replies ("can we pay half now?"), the agent reads the reply, proposes a plan inside the freelancer's rules, and sets it up in PayPal.

Plus a **Money view** that shows who owes what, predicted pay dates and a 30-day cash forecast.

### Why this needs both PayPal and AI

- **PayPal does the money:** invoicing, reminders, QR codes, pay links, Pay Later, recurring series, payment recording, refunds, disputes, transaction insights. All available as agent tools in the PayPal Agent Toolkit.
- **AI does the judgement:** extracting invoice details from messy input, scoring late-payment risk, choosing tone and timing, understanding client replies, negotiating within limits.
- Neither alone solves it. PayPal reminders already exist but are generic; AI without PayPal can only draft emails and can't move money.

---

## 4. User flows

### Flow A: First-time setup (2 minutes)

```
Sign in with PayPal (sandbox)
  → Settled reads your last 90 days of invoices and transactions
  → "You have 6 open invoices worth $9,450. 2 look likely to be late."
  → Set your chasing style: Gentle / Balanced / Firm
  → Set your rules: allow split payments? max installments? late fee?
  → Choose mode: "Ask me before sending" or "Autopilot"
  → Land on Home
```

### Flow B: Create an invoice by talking (the hero moment)

```
Home → "New invoice" (or just type in the agent bar)
  Priya types: "Bill Mark at Northwind $2,400 for the rebrand, half due now, rest in 30 days"
  → Agent drafts the invoice: client, line items, 2 payment terms, due dates
  → Shows a preview card with anything it guessed highlighted ("Is Mark's email mark@northwind.co?")
  → Priya taps "Send"
  → PayPal invoice is created and sent (create_invoice → send_invoice), QR code generated
  → Card moves to "Waiting" with predicted pay date
```

Alternative inputs: paste an email thread, or drop in a contract PDF. The agent extracts the same fields.

### Flow C: The agent chases (runs in the background)

```
Every day the agent checks open invoices (list_invoices / get_invoice)
  For each one:
    → Scores risk: client's history, amount, days since sent, whether they opened it
    → Decides: wait, nudge, remind, or escalate
    → Drafts the message in Priya's tone, with a one-tap PayPal pay link and Pay Later mention
  If mode = "Ask me": Priya gets a digest: "3 reminders ready. Approve all?"
  If mode = Autopilot: sends (send_invoice_reminder) and logs it in the timeline
  When paid → invoice marked paid, Priya gets "Mark paid $1,200 🎉"
```

Escalation ladder (configurable): friendly nudge before due → reminder on due date → firmer note +7 days → offer split plan +14 days → flag to Priya for a personal call +21 days. The agent never threatens, never adds fees Priya didn't approve.

### Flow D: Client can't pay in full (the "negotiation")

```
Mark replies to a reminder: "Cash is tight, can I do $600 now and the rest next month?"
  → Agent reads the reply, checks Priya's rules (splits allowed, max 3 parts)
  → Within rules: proposes a plan to Priya → she taps Approve
     → Agent cancels/updates the original invoice and creates a split
       (record partial payment + new invoice, or a recurring series for installments)
     → Replies to Mark with the new plan and pay link
  → Outside rules (e.g. asks for 50% discount): agent never agrees; hands it to Priya with a suggested reply
```

### Flow E: The client's side (no account needed)

```
Mark opens the email/SMS → sees a clear, friendly summary
  → "Pay $1,200" button → PayPal checkout (PayPal, card, Venmo, or Pay Later)
  → Done in under 30 seconds
```

### Flow F: The Money view

```
Home → Money
  → Grid of all invoices: client, amount, due, status, risk, predicted pay date, last agent action
  → 30-day cash forecast chart (expected vs at-risk)
  → Ask the agent: "How much will I get before the 1st?" → answer from live PayPal data (get_merchant_insights, list_transactions)
```

---

## 5. Screen-by-screen UX

Design principles: calm, not alarming (money stress is the problem we're removing); the agent always shows what it will do before money or messages move; every number links to the PayPal record behind it.

### Screen 1: Home

```
┌──────────────────────────────────────────────────────────────┐
│ Settled                                         Priya ▾      │
├──────────────────────────────────────────────────────────────┤
│  You're owed            Expected in 7 days     At risk       │
│  $9,450                 $3,600                 $2,400 ⚠      │
├──────────────────────────────────────────────────────────────┤
│  ┌ Ask Settled ──────────────────────────────────────────┐   │
│  │ "Bill Mark $2,400 for the rebrand, half now..."     ➤ │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  Needs you (2)                                               │
│  ▸ 3 reminders ready to send            [Review] [Send all]  │
│  ▸ Northwind asked to split $2,400      [See plan]           │
│                                                              │
│  Recent activity                                             │
│  ✓ Acme paid $800 · 2h ago (reminded once)                   │
│  ✉ Nudged Bloom Café about $450 · yesterday                  │
│  + Invoice #0142 sent to Northwind · 3d ago                  │
└──────────────────────────────────────────────────────────────┘
```

### Screen 2: Invoice draft (after typing a request)

```
┌ New invoice · drafted by Settled ───────────────────────────┐
│ To:   Mark Lee, Northwind  mark@northwind.co  [? confirm]   │
│ Item: Brand refresh (logo, palette, guidelines)   $2,400.00 │
│ Terms:                                                      │
│   Part 1  $1,200  due today                                 │
│   Part 2  $1,200  due Dec 9                                 │
│ Client can pay with: PayPal · Card · Venmo · Pay Later      │
│                                                             │
│ Settled will remind: 2 days before each due date            │
│                                                             │
│  [Edit]                      [Send via PayPal]              │
└─────────────────────────────────────────────────────────────┘
```

Guessed fields are highlighted with a "?" until confirmed. Nothing is sent until "Send".

### Screen 3: Invoice detail / timeline

```
Invoice #0142 · Northwind · $2,400        Risk: Medium (62%)
Predicted paid: Nov 21                    Why? Paid late twice before, large amount
────────────────────────────────────────────────────────────
Nov 9   Created and sent via PayPal
Nov 12  Opened by client
Nov 16  Settled sent a friendly reminder        [View message]
Nov 18  Client replied: "Can I split this?"
Nov 18  Settled proposed 2 × $1,200 → you approved
Nov 18  $1,200 paid with Pay Later ✓
────────────────────────────────────────────────────────────
Next step: reminder for part 2 on Dec 7   [Change] [Pause chasing]
```

### Screen 4: Approval card (the human-in-the-loop moment)

```
┌ Settled wants to send this ─────────────────────────────────┐
│ To Bloom Café · Invoice #0139 · $450 · 6 days overdue       │
│                                                             │
│ "Hi Sam, hope the holiday menu launch went well! Just a     │
│  quick note that the $450 for the menu design is still      │
│  open. You can pay in one tap here, or split it with Pay    │
│  Later if that's easier. Thanks! Priya"                     │
│                                                             │
│ Why now: Sam usually pays within 2 days of a reminder.      │
│                                                             │
│ [Edit]  [Make it firmer]  [Skip]          [Send]            │
└─────────────────────────────────────────────────────────────┘
```

### Screen 5: Split-plan proposal

```
┌ Northwind asked to split $2,400 ────────────────────────────┐
│ Their message: "Cash is tight, can I do $600 now and the    │
│ rest next month?"                                           │
│                                                             │
│ Settled suggests (within your rules: max 3 parts):          │
│   $1,200 now · $1,200 Dec 9                                 │
│   or let them use Pay Later and you get $2,400 now          │
│                                                             │
│ [Offer my suggestion]  [Accept their ask]  [I'll reply]     │
└─────────────────────────────────────────────────────────────┘
```

### Screen 6: Money view

- Top: 30-day cash forecast area chart (paid / expected / at risk).
- Main: invoice grid (AG Grid): sortable, filterable, risk shown as a coloured pill, inline "Pause chasing" toggle, row expands to the timeline.
- Right panel: agent chat that answers money questions from live PayPal data.

### Screen 7: Settings → "How Settled chases"

- Tone: Gentle / Balanced / Firm, with a preview message.
- Mode: Ask me first / Autopilot under $X / Full autopilot.
- Splits: allowed? max parts? minimum first payment %.
- Never: discounts, late fees, or messages after 8pm unless I turn them on.
- Per-client overrides ("Never auto-chase Acme, they're my biggest client").

### Client-facing page (email / pay page)

Clean single card: who it's from, what it's for, amount, due date, a big "Pay $1,200" PayPal button with Pay Later and Venmo shown, and a small "Need more time? Reply to this email" link (which the agent handles).

---

## 6. Trust and safety rules for the agent

- Never sends a message or moves money without either approval or an explicit autopilot rule.
- Never agrees to discounts, write-offs or refunds by itself.
- Never invents facts about the work; only uses invoice data and the freelancer's notes.
- Every agent action is logged on the invoice timeline with a "why".
- One-click "Pause all chasing".

---

## 7. How it maps to PayPal and AI

| Feature | PayPal (sandbox) via Agent Toolkit / REST | AI |
|---|---|---|
| Create invoice from text/PDF | `create_invoice`, `generate_invoice_number`, `send_invoice`, `generate_invoice_qr_code` | Extract client, items, terms; flag guesses |
| Chasing | `list_invoices`, `get_invoice`, `send_invoice_reminder` | Risk score, timing, tone-matched message |
| Split plans | `update_invoicing`, `record_payment_for_invoice`, `create_recurring_series`, `cancel_sent_invoice` | Read client reply, propose plan within rules |
| Client pays | Invoice pay page / Checkout with Pay Later, Venmo, card; webhooks for payment events | n/a |
| Money view + Q&A | `list_transactions`, `get_merchant_insights` | Forecast, natural-language answers |
| Disputes (stretch) | `list_disputes`, `get_dispute` | Summarise dispute, draft evidence |

**Suggested stack:** Next.js (TypeScript) + Vercel AI SDK + `@paypal/agent-toolkit` (sandbox mode) + Claude as the model; AG Grid for the Money view; deployed on Render for a public demo URL.

**Sponsor prizes this targets:** AG Grid (Money view grid, top prize $5k) and Render (hosting). Honorable mentions: Best Use of PayPal + AI, Most Impactful, Best Use of Agentic Commerce.

---

## 8. Three-day build scope

**Must have (MVP, Nov 9 to 11):**
1. Flow B: create and send invoice from a sentence (real sandbox invoice).
2. Flow C in "Ask me" mode: risk score + drafted reminder + approve → `send_invoice_reminder`.
3. Flow D happy path: paste a client reply → split plan → updated invoices in sandbox.
4. Flow E: client pays in the sandbox (sandbox buyer account) → status flips to Paid.
5. Money view with AG Grid + simple forecast.

**Nice to have:** PDF/email input, autopilot scheduler, per-client overrides, disputes.

**Fake it honestly:** seed 6 to 8 sandbox invoices with varied histories so risk scores and the forecast look real in the demo. Say in the README that the data is seeded.

**Nov 12 morning:** README with setup + sandbox test accounts, MIT LICENSE, video, Devpost form before 12:00 pm PT.

---

## 9. 3-minute demo script

| Time | Shot |
|---|---|
| 0:00–0:20 | The problem: "29% of freelance invoices are paid late. Priya spends a workday a month chasing." |
| 0:20–0:50 | Priya types one sentence → invoice drafted → sent via PayPal sandbox (show it in the sandbox dashboard). |
| 0:50–1:30 | Home shows "3 reminders ready". Open one: risk reason, tone-matched message. Approve → sent. |
| 1:30–2:10 | Client replies "can I split?" → agent proposes a plan within rules → approve → client pays part 1 with sandbox buyer. Status flips to Paid live. |
| 2:10–2:40 | Money view: AG Grid, forecast, ask "how much before the 1st?" |
| 2:40–3:00 | Outcome + who it's for + "built on PayPal Agent Toolkit + Claude". |

---

## 10. Judging fit

- **Technological implementation:** real agent loop using many PayPal tools (invoicing, reminders, recurring, transactions, insights), not one checkout button.
- **Design:** full product: setup, home, approvals, timeline, money view, client page.
- **Potential impact:** a specific, measured problem with a specific audience.
- **Innovation:** existing tools send fixed reminders; Settled judges timing, tone and negotiates splits, and uses Pay Later to turn the client's cash problem into an on-time payment.
- **Presentation:** the story has a clear before/after and a live payment in the video.
