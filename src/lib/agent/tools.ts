import { z } from "zod";
import { addDays, todayISO } from "@/lib/dates";
import { computeSummary, effectiveStatus, factualSummary } from "@/lib/metrics";
import { formatMoney } from "@/lib/money";
import { createApproval } from "@/lib/services/approvals";
import type { ServiceContext } from "@/lib/services/context";
import type { Approval, Client, Invoice } from "@/lib/types";
import { CURRENCIES } from "@/lib/types";

// The AI tool layer. Read tools return real stored data. Write tools never act
// directly: they validate input against stored records and create an approval
// request that the user confirms in the UI. Execution then goes through the
// backend services, which re-run the permission service.

export interface ToolOutcome {
  /** JSON-serialisable result returned to the model. */
  result: Record<string, unknown>;
  approval?: Approval;
  summary: string;
}

export const TOOL_DEFINITIONS = [
  {
    name: "find_client",
    description: "Search the user's saved clients by name, company or email. Use before any client-specific action. Returns only clients that exist.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Name, company or email fragment" } }, required: ["query"] },
  },
  {
    name: "list_invoices",
    description: "List invoices with optional filters. Statuses: draft, sent, unpaid, partially_paid, paid, overdue (any unpaid balance past its due date, including partially paid), cancelled, refunded, open (any unpaid balance). due_within_days limits to invoices due between today and N days from now.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        client_id: { type: "string" },
        due_within_days: { type: "integer" },
      },
    },
  },
  {
    name: "retrieve_invoice",
    description: "Get one invoice by id or invoice number, including line items, PayPal ids and status.",
    input_schema: { type: "object", properties: { invoice: { type: "string", description: "Invoice id or invoice number" } }, required: ["invoice"] },
  },
  {
    name: "get_collection_summary",
    description: "Totals computed from stored invoices: outstanding, overdue, collected this month, due in the next 30 days, aging buckets, balances by client, monthly history.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "retrieve_agent_activity",
    description: "Recent agent activity log entries (what the agent did and why).",
    input_schema: { type: "object", properties: { limit: { type: "integer" }, invoice_id: { type: "string" } } },
  },
  {
    name: "create_invoice_draft",
    description: "Propose a new invoice draft for an EXISTING client (use find_client first). Requires an explicit amount from the user. Creates an approval request; nothing is saved until the user confirms.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "string" },
        description: { type: "string", description: "Line item description of the work" },
        amount: { type: "number", description: "Amount in major units, exactly as the user stated" },
        currency: { type: "string", enum: CURRENCIES },
        due_in_days: { type: "integer", description: "Days from today until due" },
        due_date: { type: "string", description: "YYYY-MM-DD, alternative to due_in_days" },
        project_name: { type: "string" },
      },
      required: ["client_id", "description", "amount"],
    },
  },
  {
    name: "send_invoice",
    description: "Propose sending a DRAFT invoice to the client through PayPal. Creates an approval request.",
    input_schema: { type: "object", properties: { invoice_id: { type: "string" } }, required: ["invoice_id"] },
  },
  {
    name: "send_invoice_reminder",
    description: "Propose a PayPal payment reminder for one sent, unpaid invoice. Creates an approval request.",
    input_schema: {
      type: "object",
      properties: {
        invoice_id: { type: "string" },
        tone: { type: "string", enum: ["friendly", "neutral", "firm"] },
        note: { type: "string", description: "Optional custom message to the client" },
      },
      required: ["invoice_id"],
    },
  },
  {
    name: "pause_collection_policy",
    description: "Propose pausing (or resuming) automated reminders for a client or a single invoice. Creates an approval request.",
    input_schema: {
      type: "object",
      properties: { client_id: { type: "string" }, invoice_id: { type: "string" }, paused: { type: "boolean" } },
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

function invoiceView(i: Invoice, clients: Map<string, Client>, today: string) {
  return {
    id: i.id,
    invoice_number: i.invoice_number,
    client: clients.get(i.client_id)?.name ?? "Unknown",
    client_id: i.client_id,
    status: effectiveStatus(i, today),
    total: formatMoney(i.total_cents, i.currency),
    amount_due: formatMoney(i.amount_due_cents, i.currency),
    amount_paid: formatMoney(i.amount_paid_cents, i.currency),
    currency: i.currency,
    issue_date: i.issue_date,
    due_date: i.due_date,
    paypal_invoice_id: i.paypal_invoice_id,
    paypal_mode: i.paypal_mode,
    collection_paused: i.collection_paused,
    demo_data: i.is_demo,
  };
}

const err = (message: string): ToolOutcome => ({ result: { error: message }, summary: message });

export async function executeTool(ctx: ServiceContext, name: string, rawInput: unknown): Promise<ToolOutcome> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const today = todayISO(ctx.now());
  const clients = await ctx.db.list("clients");
  const clientMap = new Map(clients.map((c) => [c.id, c]));

  switch (name as ToolName) {
    case "find_client": {
      const q = String(input.query ?? "").trim().toLowerCase();
      if (!q) return err("Provide a name to search for.");
      const hits = clients.filter((c) =>
        [c.name, c.company ?? "", c.email].some((f) => f.toLowerCase().includes(q)) ||
        c.name.toLowerCase().split(/\s+/).some((part) => part === q),
      );
      return {
        result: {
          matches: hits.map((c) => ({ id: c.id, name: c.name, company: c.company, email: c.email, currency: c.currency, collection_paused: c.collection_paused, dispute_open: c.dispute_open })),
          note: hits.length === 0 ? "No saved client matches. Do not invent one; ask the user to add the client first." : hits.length > 1 ? "Multiple matches: ask the user which one." : undefined,
        },
        summary: hits.length === 0 ? `No client matching "${q}"` : `Found ${hits.length} client(s) for "${q}"`,
      };
    }

    case "list_invoices": {
      let invs = await ctx.db.list("invoices", undefined, { orderBy: "due_date" });
      const status = input.status ? String(input.status) : null;
      if (status === "open") invs = invs.filter((i) => ["sent", "unpaid", "partially_paid"].includes(i.status) && i.amount_due_cents > 0);
      else if (status === "overdue") invs = invs.filter((i) => ["sent", "unpaid", "partially_paid"].includes(i.status) && i.amount_due_cents > 0 && i.due_date < today);
      else if (status) invs = invs.filter((i) => effectiveStatus(i, today) === status);
      if (input.client_id) invs = invs.filter((i) => i.client_id === input.client_id);
      if (typeof input.due_within_days === "number") {
        const end = addDays(today, input.due_within_days);
        invs = invs.filter((i) => i.due_date >= today && i.due_date <= end && i.amount_due_cents > 0 && !["paid", "cancelled", "draft"].includes(i.status));
      }
      return { result: { count: invs.length, invoices: invs.slice(0, 50).map((i) => invoiceView(i, clientMap, today)) }, summary: `Listed ${invs.length} invoice(s)` };
    }

    case "retrieve_invoice": {
      const key = String(input.invoice ?? "");
      const inv = (await ctx.db.get("invoices", key)) ?? (await ctx.db.findOne("invoices", { invoice_number: key }));
      if (!inv) return err(`No invoice "${key}" exists.`);
      const items = await ctx.db.list("invoice_items", { invoice_id: inv.id });
      return {
        result: { ...invoiceView(inv, clientMap, today), items: items.map((it) => ({ description: it.description, quantity: it.quantity, unit_amount: formatMoney(it.unit_amount_cents, inv.currency) })) },
        summary: `Retrieved ${inv.invoice_number}`,
      };
    }

    case "get_collection_summary": {
      const profile = await ctx.db.profile();
      const s = computeSummary(await ctx.db.list("invoices"), clients, ctx.now(), profile.default_currency);
      const fmt = (c: number) => formatMoney(c, s.currency);
      return {
        result: {
          currency: s.currency,
          factual_summary: factualSummary(s, fmt),
          outstanding: fmt(s.outstandingCents),
          outstanding_invoices: s.outstandingCount,
          overdue: fmt(s.overdueCents),
          overdue_invoices: s.overdueCount,
          collected_this_month: fmt(s.collectedThisMonthCents),
          due_next_30_days: fmt(s.expectedNext30Cents),
          due_next_30_days_note: "Based on due dates of open invoices; not confirmed payments.",
          collection_rate: s.collectionRate == null ? null : `${Math.round(s.collectionRate * 100)}%`,
          aging: Object.fromEntries(Object.entries(s.aging).map(([k, v]) => [k, { amount: fmt(v.cents), count: v.count }])),
          by_client: s.byClient.map((c) => ({ client: c.name, client_id: c.clientId, outstanding: fmt(c.outstanding), overdue: fmt(c.overdue), collected: fmt(c.collected) })),
          monthly: s.monthly.map((m) => ({ month: m.month, invoiced: fmt(m.invoiced), collected: fmt(m.collected) })),
          includes_demo_data: s.hasDemoData,
        },
        summary: "Computed collection summary",
      };
    }

    case "retrieve_agent_activity": {
      const limit = Math.min(Number(input.limit ?? 10) || 10, 30);
      const rows = (await ctx.db.list("agent_activity", input.invoice_id ? { invoice_id: String(input.invoice_id) } : undefined, { orderBy: "created_at", ascending: false, limit }));
      return {
        result: { activity: rows.map((a) => ({ at: a.created_at, category: a.category, action: a.proposed_action, status: a.execution_status, reasoning: a.reasoning, error: a.error })) },
        summary: `Read ${rows.length} activity entries`,
      };
    }

    case "create_invoice_draft": {
      const parsed = z
        .object({
          client_id: z.string().min(1),
          description: z.string().trim().min(1).max(200),
          amount: z.number().positive().max(1_000_000),
          currency: z.enum(CURRENCIES as [string, ...string[]]).optional(),
          due_in_days: z.number().int().min(0).max(365).optional(),
          due_date: z.iso.date().optional(),
          project_name: z.string().max(120).optional(),
        })
        .safeParse(input);
      if (!parsed.success) return err(`Invalid invoice details: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}. Ask the user for the missing information.`);
      const v = parsed.data;
      const client = clientMap.get(v.client_id);
      if (!client) return err("That client id does not exist. Use find_client, and ask the user to add the client if needed.");
      const currency = v.currency ?? client.currency;
      if (currency !== client.currency) {
        return err(`${client.name} is billed in ${client.currency}, but ${currency} was requested. Confirm the currency with the user.`);
      }
      const due = v.due_date ?? addDays(today, v.due_in_days ?? 14);
      const payload = {
        input: {
          client_id: client.id,
          project_name: v.project_name ?? null,
          currency,
          issue_date: today,
          due_date: due,
          note: null,
          items: [{ description: v.description, quantity: 1, unit_amount: v.amount }],
        },
      };
      const approval = await createApproval(ctx, {
        kind: "create_invoice",
        source: "chat",
        summary: `Create draft invoice for ${client.name}: ${v.description}, ${formatMoney(Math.round(v.amount * 100), currency)}, due ${due}`,
        reasoning: v.due_date || v.due_in_days != null ? null : "No due date was given, so the default of 14 days is proposed.",
        payload,
        client_id: client.id,
      });
      return { result: { status: "awaiting_user_approval", approval_id: approval.id, proposal: approval.summary }, approval, summary: approval.summary };
    }

    case "send_invoice": {
      const inv = await ctx.db.get("invoices", String(input.invoice_id ?? ""));
      if (!inv) return err("Invoice not found.");
      if (inv.status !== "draft") return err(`Invoice ${inv.invoice_number} is ${inv.status}; only drafts can be sent.`);
      const client = clientMap.get(inv.client_id);
      const approval = await createApproval(ctx, {
        kind: "send_invoice",
        source: "chat",
        summary: `Send ${inv.invoice_number} (${formatMoney(inv.total_cents, inv.currency)}) to ${client?.name} <${client?.email}> via PayPal`,
        payload: { invoice_id: inv.id },
        invoice_id: inv.id,
        client_id: inv.client_id,
        idempotency_key: `chat:send:${inv.id}`,
      });
      return { result: { status: "awaiting_user_approval", approval_id: approval.id, proposal: approval.summary }, approval, summary: approval.summary };
    }

    case "send_invoice_reminder": {
      const inv = await ctx.db.get("invoices", String(input.invoice_id ?? ""));
      if (!inv) return err("Invoice not found.");
      if (["paid", "cancelled", "refunded", "draft"].includes(inv.status) || inv.amount_due_cents <= 0) {
        return err(`No reminder possible: ${inv.invoice_number} is ${inv.status}.`);
      }
      const client = clientMap.get(inv.client_id);
      if (client?.dispute_open || inv.dispute_open) return err(`Collection for ${client?.name} is stopped because a dispute is recorded.`);
      const tone = (["friendly", "neutral", "firm"] as const).find((t) => t === input.tone) ?? "friendly";
      const approval = await createApproval(ctx, {
        kind: "send_reminder",
        source: "chat",
        summary: `Send a ${tone} PayPal reminder for ${inv.invoice_number} to ${client?.name} (${formatMoney(inv.amount_due_cents, inv.currency)} due ${inv.due_date})`,
        payload: { invoice_id: inv.id, tone, note: typeof input.note === "string" ? input.note.slice(0, 1000) : undefined },
        invoice_id: inv.id,
        client_id: inv.client_id,
        idempotency_key: `chat:remind:${inv.id}:${today}`,
      });
      return { result: { status: "awaiting_user_approval", approval_id: approval.id, proposal: approval.summary }, approval, summary: approval.summary };
    }

    case "pause_collection_policy": {
      const paused = input.paused !== false;
      const client = input.client_id ? clientMap.get(String(input.client_id)) : null;
      const inv = input.invoice_id ? await ctx.db.get("invoices", String(input.invoice_id)) : null;
      if (!client && !inv) return err("Specify an existing client or invoice.");
      const target = inv ? `invoice ${inv.invoice_number}` : client!.name;
      const approval = await createApproval(ctx, {
        kind: "pause_collection",
        source: "chat",
        summary: `${paused ? "Pause" : "Resume"} automated reminders for ${target}`,
        payload: { client_id: inv ? null : client!.id, invoice_id: inv?.id ?? null, paused },
        client_id: inv?.client_id ?? client!.id,
        invoice_id: inv?.id ?? null,
      });
      return { result: { status: "awaiting_user_approval", approval_id: approval.id, proposal: approval.summary }, approval, summary: approval.summary };
    }

    default:
      return err(`Unknown tool ${name}`);
  }
}
