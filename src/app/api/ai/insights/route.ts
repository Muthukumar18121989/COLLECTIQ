import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { env, integrationModes } from "@/lib/env";
import { log } from "@/lib/logger";
import { computeSummary, factualSummary } from "@/lib/metrics";
import { formatMoney } from "@/lib/money";
import { rateLimit } from "@/lib/rate-limit";
import { apiRoute, jsonError } from "@/lib/server";

/** AI financial summary grounded strictly in computed figures. */
export const POST = apiRoute(async (_req, { ctx, profile, user }) => {
  const rl = rateLimit(`insights:${user.id}`, 6, 60_000);
  if (!rl.ok) return jsonError(`Please wait ${rl.retryAfterSec}s.`, 429, "rate_limited");
  const s = computeSummary(await ctx.db.list("invoices"), await ctx.db.list("clients"), new Date(), profile.default_currency);
  const f = (c: number) => formatMoney(c, s.currency);
  const base = factualSummary(s, f);
  if (integrationModes().ai !== "claude") {
    return NextResponse.json({ engine: "demo", text: base });
  }
  const facts = {
    currency: s.currency,
    outstanding: f(s.outstandingCents),
    open_invoices: s.outstandingCount,
    overdue: f(s.overdueCents),
    overdue_invoices: s.overdueCount,
    collected_this_month: f(s.collectedThisMonthCents),
    due_next_30_days_by_due_date: f(s.expectedNext30Cents),
    collection_rate: s.collectionRate == null ? null : `${Math.round(s.collectionRate * 100)}%`,
    aging: Object.fromEntries(Object.entries(s.aging).map(([k, v]) => [k, `${f(v.cents)} (${v.count})`])),
    by_client: s.byClient.slice(0, 8).map((c) => ({ client: c.name, outstanding: f(c.outstanding), overdue: f(c.overdue), collected: f(c.collected) })),
    monthly: s.monthly.map((m) => ({ month: m.month, invoiced: f(m.invoiced), collected: f(m.collected) })),
    includes_demo_data: s.hasDemoData,
  };
  try {
    const client = new Anthropic({ apiKey: env.anthropic.apiKey });
    const res = await client.messages.create({
      model: env.anthropic.model,
      max_tokens: 500,
      system:
        "You write a short cash-flow briefing for a freelancer. Use ONLY the figures in the provided JSON; never compute new totals, estimate, or invent numbers. Expected amounts are due dates, not confirmed payments: say so. If includes_demo_data is true, say the figures include demo data. 3 to 5 sentences, plain text, then up to 3 bullet points of suggested next actions (e.g. which invoices to follow up), each starting with '- '.",
      messages: [{ role: "user", content: JSON.stringify(facts) }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return NextResponse.json({ engine: "claude", text: text || base });
  } catch (e) {
    log.error("ai.insights_failed", { error: (e as Error).message });
    return NextResponse.json({ engine: "demo", text: base, warning: "Claude was unavailable; showing the computed summary instead." });
  }
});
