import { daysBetween } from "@/lib/dates";
import { createApproval } from "@/lib/services/approvals";
import type { ServiceContext } from "@/lib/services/context";
import type { PolicyStep } from "@/lib/types";

// ADAPTIVE mode: analyse stored collection history and *recommend* policy
// changes. Recommendations are approval requests; nothing changes until the
// user approves. Each recommendation states the data it is based on.

export interface Recommendation {
  summary: string;
  evidence: string;
  changes: Record<string, unknown>;
}

export async function analysePolicies(ctx: ServiceContext): Promise<Recommendation[]> {
  const policy = await ctx.db.findOne("collection_policies", { is_default: true });
  if (!policy) return [];
  const invoices = await ctx.db.list("invoices");
  const paid = invoices.filter((i) => i.status === "paid" && i.paid_at);
  const recs: Recommendation[] = [];

  if (paid.length >= 3) {
    const lateness = paid.map((i) => daysBetween(i.due_date, i.paid_at!)).sort((a, b) => a - b);
    const median = lateness[Math.floor(lateness.length / 2)];
    const lateCount = lateness.filter((d) => d > 0).length;
    const hasEarly = policy.steps.some((s) => s.offset_days <= -7);
    if (median > 3 && !hasEarly) {
      const step: PolicyStep = { id: "pre_due_7", offset_days: -7, action: "reminder", tone: "friendly", requires_approval: false, label: "Early heads-up 7 days before due" };
      recs.push({
        summary: `Add an early friendly reminder 7 days before the due date to "${policy.name}"`,
        evidence: `${lateCount} of ${paid.length} paid invoices were paid after their due date; the median was ${median} day(s) late.`,
        changes: { steps: [...policy.steps, step].sort((a, b) => a.offset_days - b.offset_days) },
      });
    }
  }

  const reminderTasks = await ctx.db.list("agent_tasks", { status: "succeeded" });
  const reminded = new Set(reminderTasks.filter((t) => t.kind === "reminder").map((t) => t.invoice_id));
  const paidAfterReminder = paid.filter((i) => reminded.has(i.id)).length;
  if (reminded.size >= 4 && paidAfterReminder / reminded.size < 0.25 && policy.min_days_between_reminders > 2) {
    recs.push({
      summary: `Shorten the minimum gap between reminders in "${policy.name}" to 2 days`,
      evidence: `Only ${paidAfterReminder} of ${reminded.size} reminded invoices have been paid so far.`,
      changes: { min_days_between_reminders: 2 },
    });
  }
  return recs;
}

export async function createRecommendations(ctx: ServiceContext) {
  const profile = await ctx.db.profile();
  if (profile.autonomy_mode !== "adaptive") {
    return { created: 0, message: "Switch autonomy mode to Adaptive in Settings to get policy recommendations." };
  }
  const policy = await ctx.db.findOne("collection_policies", { is_default: true });
  const recs = await analysePolicies(ctx);
  for (const r of recs) {
    await createApproval(ctx, {
      kind: "policy_recommendation",
      source: "adaptive",
      summary: r.summary,
      reasoning: r.evidence,
      payload: { policy_id: policy!.id, changes: r.changes },
      idempotency_key: `adaptive:${policy!.id}:${r.summary}`,
    });
  }
  return {
    created: recs.length,
    message: recs.length ? `${recs.length} recommendation(s) are waiting for your approval.` : "Not enough history yet to recommend a change. Recommendations need at least 3 paid invoices.",
  };
}
