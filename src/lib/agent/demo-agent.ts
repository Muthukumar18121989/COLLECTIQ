import { todayISO } from "@/lib/dates";
import type { ServiceContext } from "@/lib/services/context";
import type { Approval } from "@/lib/types";
import { parseIntent } from "./intent";
import { executeTool } from "./tools";

export interface AgentReply {
  text: string;
  toolCalls: Array<{ name: string; input: unknown; result_summary: string }>;
  approvals: Approval[];
  engine: "claude" | "demo";
}

type Row = Record<string, string | number | boolean | null>;

/**
 * Rule-based agent used when ANTHROPIC_API_KEY is not set. It goes through the
 * exact same tool layer (and therefore the same validation and approval flow)
 * as the Claude agent; only the language understanding is simpler.
 */
export async function runDemoAgent(ctx: ServiceContext, message: string): Promise<AgentReply> {
  const clients = await ctx.db.list("clients");
  const intent = parseIntent(message, clients);
  const calls: AgentReply["toolCalls"] = [];
  const approvals: Approval[] = [];
  const call = async (name: string, input: Record<string, unknown>) => {
    const out = await executeTool(ctx, name, input);
    calls.push({ name, input, result_summary: out.summary });
    if (out.approval) approvals.push(out.approval);
    return out.result;
  };
  const reply = (text: string): AgentReply => ({ text, toolCalls: calls, approvals, engine: "demo" });

  if (intent.clarification) {
    if (intent.requestedClientName) await call("find_client", { query: intent.requestedClientName });
    return reply(intent.clarification);
  }

  switch (intent.kind) {
    case "create_invoice": {
      const r = await call("create_invoice_draft", {
        client_id: intent.client!.id,
        description: intent.description,
        amount: intent.amount,
        currency: intent.currency,
        due_in_days: intent.dueInDays,
        due_date: intent.dueDate,
      });
      if (r.error) return reply(String(r.error));
      return reply(`Here's the draft I'd create. Nothing is saved until you approve it below.\n\n**${r.proposal}**\n\nAfter it's created you can review it and send it through PayPal.`);
    }
    case "send_invoice": {
      const inv = (await call("retrieve_invoice", { invoice: intent.invoiceNumber })) as Row;
      if (inv.error) return reply(String(inv.error));
      const r = await call("send_invoice", { invoice_id: inv.id });
      if (r.error) return reply(String(r.error));
      return reply(`Ready to send. Approve below and I'll create and send it through PayPal; I'll only confirm once PayPal responds.\n\n**${r.proposal}**`);
    }
    case "list_overdue":
    case "list_invoices":
    case "due_this_week": {
      const input: Record<string, unknown> =
        intent.kind === "list_overdue" ? { status: "overdue" } : intent.kind === "due_this_week" ? { due_within_days: 7 } : {};
      if (intent.client) input.client_id = intent.client.id;
      const r = (await call("list_invoices", input)) as { count: number; invoices: Row[] };
      const label = intent.kind === "list_overdue" ? "overdue" : intent.kind === "due_this_week" ? "due in the next 7 days" : "on record";
      if (r.count === 0) return reply(`No invoices ${label}${intent.client ? ` for ${intent.client.name}` : ""}.`);
      const lines = r.invoices.map((i) => `- **${i.invoice_number}** · ${i.client} · ${i.amount_due} due ${i.due_date} · ${i.status}`);
      return reply(`${r.count} invoice${r.count === 1 ? "" : "s"} ${label}:\n${lines.join("\n")}`);
    }
    case "top_debtor": {
      const s = (await call("get_collection_summary", {})) as { by_client: Row[] };
      const top = s.by_client.find((c) => c.outstanding !== "$0.00");
      if (!top) return reply("No client has an outstanding balance right now.");
      return reply(`**${top.client}** owes you the most: ${top.outstanding} outstanding (${top.overdue} of it overdue).`);
    }
    case "expected_income":
    case "summary":
    case "explain_outstanding": {
      const s = (await call("get_collection_summary", {})) as Record<string, unknown>;
      let text = String(s.factual_summary);
      if (intent.kind === "explain_outstanding") {
        const monthly = s.monthly as Row[];
        const recent = monthly.slice(-2);
        text += `\n\nRecent months (invoiced vs collected): ${recent.map((m) => `${m.month}: ${m.invoiced} invoiced, ${m.collected} collected`).join("; ")}. Outstanding grows when you invoice more than clients pay in the same period, or when invoices pass their due date unpaid.`;
      }
      if (intent.kind === "expected_income") {
        text = `Due in the next 30 days: ${s.due_next_30_days} (${s.due_next_30_days_note}) Collected so far this month: ${s.collected_this_month}. Overdue that could still come in: ${s.overdue}.`;
      }
      if (s.includes_demo_data) text += "\n\n_Includes demo data._";
      return reply(text);
    }
    case "prepare_reminders": {
      const input: Record<string, unknown> = { status: "overdue" };
      if (intent.client) input.client_id = intent.client.id;
      let list = (await call("list_invoices", input)) as { invoices: Row[] };
      if (list.invoices.length === 0) list = (await call("list_invoices", { ...input, status: "open" })) as { invoices: Row[] };
      const eligible = list.invoices.filter((i) => !i.collection_paused);
      if (eligible.length === 0) return reply("There are no unpaid invoices that need a reminder right now.");
      const proposed: string[] = [];
      const skipped: string[] = [];
      for (const inv of eligible.slice(0, 8)) {
        const overdue = String(inv.due_date) < todayISO(ctx.now());
        const r = await call("send_invoice_reminder", { invoice_id: inv.id, tone: overdue ? "neutral" : "friendly" });
        if (r.error) skipped.push(`${inv.invoice_number}: ${r.error}`);
        else proposed.push(String(r.proposal));
      }
      let text = proposed.length
        ? `I've prepared ${proposed.length} reminder${proposed.length === 1 ? "" : "s"}. Each one checks PayPal's latest status before it goes out. Approve the ones you want sent:\n${proposed.map((p) => `- ${p}`).join("\n")}`
        : "I couldn't prepare any reminders.";
      if (skipped.length) text += `\n\nSkipped:\n${skipped.map((s) => `- ${s}`).join("\n")}`;
      return reply(text);
    }
    case "pause_reminders":
    case "resume_reminders": {
      const r = await call("pause_collection_policy", { client_id: intent.client!.id, paused: intent.kind === "pause_reminders" });
      if (r.error) return reply(String(r.error));
      return reply(`Approve below to confirm: **${r.proposal}**.`);
    }
    default:
      return reply(
        "I can help with invoices and collections. Try:\n- Create an invoice for Sarah for $850 for branding work, due in seven days\n- Show all overdue invoices\n- Which client owes me the most money?\n- Prepare reminders for clients who haven't paid\n- How much money am I expecting this month?\n- Pause reminders for Alex",
      );
  }
}
