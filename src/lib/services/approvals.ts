import type { Approval, ApprovalKind, CollectionPolicy, PolicyStep } from "@/lib/types";
import { policyInputSchema } from "@/lib/validation";
import { type ServiceContext, ServiceError, recordActivity } from "./context";
import { cancelInvoice, createInvoiceDraft, remindInvoice, sendInvoice } from "./invoices";
import { setCollectionPaused } from "./collection";

export async function createApproval(
  ctx: ServiceContext,
  a: {
    kind: ApprovalKind;
    source: Approval["source"];
    summary: string;
    reasoning?: string | null;
    payload: Record<string, unknown>;
    invoice_id?: string | null;
    client_id?: string | null;
    agent_task_id?: string | null;
    idempotency_key?: string | null;
  },
): Promise<Approval> {
  if (a.idempotency_key) {
    const existing = await ctx.db.findOne("approvals", { idempotency_key: a.idempotency_key, status: "pending" });
    if (existing) return existing;
  }
  const approval = await ctx.db.insert("approvals", {
    kind: a.kind,
    status: "pending",
    source: a.source,
    summary: a.summary,
    reasoning: a.reasoning ?? null,
    payload: a.payload,
    invoice_id: a.invoice_id ?? null,
    client_id: a.client_id ?? null,
    agent_task_id: a.agent_task_id ?? null,
    idempotency_key: a.idempotency_key ?? null,
    result: null,
    decided_at: null,
  });
  await recordActivity(ctx, {
    category: a.kind === "send_reminder" || a.kind === "escalation" ? "reminder_prepared" : "approval_requested",
    invoice_id: a.invoice_id ?? null,
    client_id: a.client_id ?? null,
    trigger: a.source === "scheduler" ? "Collection scheduler" : a.source === "chat" ? "AI Command Center" : a.source,
    reasoning: a.reasoning ?? null,
    proposed_action: a.summary,
    permission_result: "require_approval",
    approval_status: "pending",
    execution_status: "approval_required",
    metadata: { approval_id: approval.id },
  });
  return approval;
}

/** Approve (and execute) or reject a pending approval. Permissions are re-checked inside each executor. */
export async function decideApproval(ctx: ServiceContext, id: string, decision: "approve" | "reject"): Promise<Approval> {
  const approval = await ctx.db.require("approvals", id);
  if (approval.status !== "pending") {
    throw new ServiceError(`This request is already ${approval.status}.`, 409, "not_pending");
  }
  const decidedAt = ctx.now().toISOString();

  if (decision === "reject") {
    const rejected = await ctx.db.update("approvals", id, { status: "rejected", decided_at: decidedAt });
    if (approval.agent_task_id) await ctx.db.update("agent_tasks", approval.agent_task_id, { status: "skipped", error: "Rejected by user" });
    await recordActivity(ctx, {
      category: "approval_decided",
      invoice_id: approval.invoice_id,
      client_id: approval.client_id,
      trigger: "Your decision",
      proposed_action: approval.summary,
      approval_status: "rejected",
      execution_status: "info",
    });
    return rejected;
  }

  // Claim the approval first so a double click cannot execute twice.
  await ctx.db.update("approvals", id, { status: "approved", decided_at: decidedAt });
  const p = approval.payload as Record<string, unknown>;
  try {
    let result: Record<string, unknown> = {};
    switch (approval.kind) {
      case "create_invoice": {
        const inv = await createInvoiceDraft(ctx, p.input, { actor: "agent_chat", approved: true, reasoning: approval.reasoning ?? undefined });
        result = { invoice_id: inv.id, invoice_number: inv.invoice_number };
        break;
      }
      case "send_invoice": {
        const inv = await sendInvoice(ctx, String(p.invoice_id), { actor: "agent_chat", approved: true });
        result = { invoice_id: inv.id, paypal_invoice_id: inv.paypal_invoice_id, mode: inv.paypal_mode };
        break;
      }
      case "send_reminder":
      case "escalation": {
        const policy = p.policy_id ? await ctx.db.get("collection_policies", String(p.policy_id)) : null;
        const out = await remindInvoice(ctx, String(p.invoice_id), {
          actor: approval.source === "scheduler" ? "scheduler" : "agent_chat",
          approved: true,
          tone: p.tone as PolicyStep["tone"] | undefined,
          note: typeof p.note === "string" ? p.note : undefined,
          policy: policy as CollectionPolicy | null,
          step: (p.step as PolicyStep) ?? null,
          taskId: approval.agent_task_id ?? undefined,
          trigger: "Approved by you",
          reasoning: approval.reasoning ?? undefined,
        });
        result = { outcome: out.outcome, ...(out.outcome === "suppressed" ? { reason: out.reason } : { mode: out.mode }) };
        break;
      }
      case "cancel_invoice": {
        const inv = await cancelInvoice(ctx, String(p.invoice_id), { actor: "agent_chat", approved: true, reason: p.reason as string | undefined });
        result = { invoice_id: inv.id, status: inv.status };
        break;
      }
      case "pause_collection": {
        await setCollectionPaused(ctx, {
          clientId: (p.client_id as string) ?? null,
          invoiceId: (p.invoice_id as string) ?? null,
          paused: p.paused !== false,
          actor: "agent_chat",
          approved: true,
        });
        result = { paused: p.paused !== false };
        break;
      }
      case "policy_recommendation": {
        const policy = await ctx.db.require("collection_policies", String(p.policy_id));
        const parsed = policyInputSchema.parse({ ...policy, ...(p.changes as object) });
        await ctx.db.update("collection_policies", policy.id, parsed);
        await recordActivity(ctx, {
          category: "policy_updated",
          trigger: "Adaptive recommendation approved",
          reasoning: approval.reasoning,
          proposed_action: approval.summary,
          approval_status: "approved",
          execution_status: "succeeded",
        });
        result = { policy_id: policy.id };
        break;
      }
    }
    const done = await ctx.db.update("approvals", id, { status: "executed", result });
    await recordActivity(ctx, {
      category: "approval_decided",
      invoice_id: approval.invoice_id,
      client_id: approval.client_id,
      trigger: "Your decision",
      proposed_action: approval.summary,
      approval_status: "approved",
      execution_status: "succeeded",
      metadata: { approval_id: id, result },
    });
    return done;
  } catch (e) {
    const message = (e as Error).message;
    const failed = await ctx.db.update("approvals", id, { status: "failed", result: { error: message } });
    if (approval.agent_task_id) {
      const t = await ctx.db.get("agent_tasks", approval.agent_task_id);
      if (t && t.status === "pending_approval") await ctx.db.update("agent_tasks", t.id, { status: "failed", error: message });
    }
    if (e instanceof ServiceError) throw new ServiceError(message, e.status, e.code, { approval: failed });
    throw e;
  }
}
