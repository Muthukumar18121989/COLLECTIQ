import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { todayISO } from "@/lib/dates";
import { log } from "@/lib/logger";
import type { ServiceContext } from "@/lib/services/context";
import type { Approval, ConversationMessage } from "@/lib/types";
import type { AgentReply } from "./demo-agent";
import { TOOL_DEFINITIONS, executeTool } from "./tools";

const MAX_STEPS = 8;

function systemPrompt(today: string, currency: string, autonomy: string) {
  return `You are COLLECTIQ, an accounts-receivable agent for a freelancer. You manage invoices and payment collection through PayPal using ONLY the provided tools.

Today is ${today}. The user's default currency is ${currency}. Autonomy mode: ${autonomy}.

Hard rules:
- Never invent a client, invoice, amount, date, status or PayPal result. Every fact you state must come from a tool result in this conversation.
- Look up clients with find_client before any client-specific action. If no saved client matches, say so and ask the user to add the client; do not create one.
- If the amount, client or what the work was for is missing or ambiguous, ask a short clarifying question instead of calling a write tool.
- Write tools (create_invoice_draft, send_invoice, send_invoice_reminder, pause_collection_policy) only create approval requests. Say clearly that the action is awaiting the user's approval in the card below. Never say an invoice was created, sent or reminded, or that a payment succeeded, unless a tool result confirms it.
- An approval request is not execution. PayPal operations run only after the user approves, and the backend re-checks permissions.
- Never offer to move money, issue refunds or change payment amounts; that is not allowed.
- When a summary includes demo data (includes_demo_data or demo_data true), mention that it is demo data.
- Expected income is based on due dates, not confirmed payments; say so when relevant.
- Be concise. Use short paragraphs or bullet lists. Format money exactly as the tools return it.`;
}

type MessageParam = Anthropic.MessageParam;

export async function runClaudeAgent(ctx: ServiceContext, history: ConversationMessage[], message: string): Promise<AgentReply> {
  const client = new Anthropic({ apiKey: env.anthropic.apiKey });
  const profile = await ctx.db.profile();
  const messages: MessageParam[] = [
    ...history.slice(-12).map((m) => ({ role: m.role, content: m.content }) as MessageParam),
    { role: "user", content: message },
  ];
  const toolCalls: AgentReply["toolCalls"] = [];
  const approvals: Approval[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.messages.create({
      model: env.anthropic.model,
      max_tokens: 1500,
      system: systemPrompt(todayISO(ctx.now()), profile.default_currency, profile.autonomy_mode),
      tools: TOOL_DEFINITIONS as unknown as Anthropic.Tool[],
      messages,
    });

    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { text: text || "Done.", toolCalls, approvals, engine: "claude" };
    }

    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      try {
        const out = await executeTool(ctx, tu.name, tu.input);
        toolCalls.push({ name: tu.name, input: tu.input, result_summary: out.summary });
        if (out.approval) approvals.push(out.approval);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out.result), is_error: Boolean(out.result.error) });
      } catch (e) {
        log.error("agent.tool_error", { tool: tu.name, error: (e as Error).message });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ error: "Tool failed. Tell the user the action could not be completed." }), is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return {
    text: "I stopped before finishing because the request needed too many steps. Could you break it into smaller requests?",
    toolCalls,
    approvals,
    engine: "claude",
  };
}
