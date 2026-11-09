import { reminderNote } from "@/lib/agent/default-policy";
import { checkPermission, type Operation } from "@/lib/agent/permissions";
import { COLLECTIBLE, evaluateInvoice } from "@/lib/agent/policy-engine";
import { todayISO } from "@/lib/dates";
import { isUniqueViolation } from "@/lib/db/store";
import { formatMoney } from "@/lib/money";
import { createApproval } from "@/lib/services/approvals";
import { type ServiceContext, ServiceError, recordActivity } from "@/lib/services/context";
import { remindInvoice, suppressPending } from "@/lib/services/invoices";
import type { AgentTask, CollectionPolicy } from "@/lib/types";

export interface CycleResult {
  evaluated: number;
  executed: number;
  approvalsRequested: number;
  manualReviews: number;
  blocked: number;
  suppressed: number;
  failed: number;
  skipped: number;
  details: Array<{ invoice: string; outcome: string; reason: string }>;
}

/**
 * One pass of the collection autopilot for one user:
 *   scheduler finds eligible invoices → policy engine picks the step →
 *   permission service decides → PayPal executes (re-checked inside remindInvoice)
 *   → every outcome is written to agent_tasks + agent_activity.
 */
export async function runCollectionCycle(ctx: ServiceContext): Promise<CycleResult> {
  const r: CycleResult = { evaluated: 0, executed: 0, approvalsRequested: 0, manualReviews: 0, blocked: 0, suppressed: 0, failed: 0, skipped: 0, details: [] };
  const profile = await ctx.db.profile();
  const policies = await ctx.db.list("collection_policies");
  const defaultPolicy = policies.find((p) => p.is_default) ?? null;
  const invoices = (await ctx.db.list("invoices")).filter((i) => COLLECTIBLE.has(i.status));
  const clients = new Map((await ctx.db.list("clients")).map((c) => [c.id, c]));
  let tasks: AgentTask[] = await ctx.db.list("agent_tasks");
  const today = todayISO(ctx.now());

  for (const invoice of invoices) {
    r.evaluated++;
    const policy: CollectionPolicy | null = (invoice.policy_id && policies.find((p) => p.id === invoice.policy_id)) || defaultPolicy;
    const ev = evaluateInvoice({ invoice, policy, tasks, now: ctx.now() });
    if (ev.closed) {
      r.suppressed += await suppressPending(ctx, invoice.id, ev.reason);
      continue;
    }
    if (ev.action === "none" || !ev.step || !ev.idempotencyKey) {
      r.skipped++;
      continue;
    }
    const client = clients.get(invoice.client_id) ?? null;
    const step = ev.step;
    const op: Operation = step.action === "reminder" ? "send_reminder" : step.action;
    const perm = checkPermission({
      op,
      actor: "scheduler",
      autonomyMode: profile.autonomy_mode,
      agentPaused: profile.agent_paused,
      approved: false,
      invoice,
      client,
      policy,
      step,
    });

    if (perm.decision === "deny") {
      // Log a block at most once per invoice/step/day; do not mark the step handled
      // so it can run once the blocker (pause, dispute) is removed.
      try {
        await ctx.db.insert("agent_tasks", {
          invoice_id: invoice.id,
          kind: step.action === "escalation" ? "escalation" : step.action === "manual_review" ? "manual_review" : "reminder",
          step_id: null,
          idempotency_key: `${ev.idempotencyKey}:blocked:${today}`,
          status: "blocked",
          trigger: "scheduler",
          scheduled_for: null,
          executed_at: ctx.now().toISOString(),
          paypal_ref: null,
          error: perm.reason,
        });
        await recordActivity(ctx, {
          category: "action_blocked",
          invoice_id: invoice.id,
          client_id: invoice.client_id,
          trigger: "Collection scheduler",
          observed_condition: ev.reason,
          proposed_action: step.label,
          permission_result: `deny: ${perm.reason}`,
          execution_status: "blocked",
        });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
      r.blocked++;
      r.details.push({ invoice: invoice.invoice_number, outcome: "blocked", reason: perm.reason });
      continue;
    }

    // Idempotency: one task per invoice+step. A failed task may be retried.
    const existing = tasks.find((t) => t.idempotency_key === ev.idempotencyKey);
    let task: AgentTask;
    const kind = step.action === "escalation" ? "escalation" : step.action === "manual_review" ? "manual_review" : "reminder";
    const initialStatus = perm.decision === "require_approval" && step.action !== "manual_review" ? "pending_approval" : "executing";
    try {
      task = existing
        ? await ctx.db.update("agent_tasks", existing.id, { status: initialStatus, error: null })
        : await ctx.db.insert("agent_tasks", {
            invoice_id: invoice.id,
            kind,
            step_id: step.id,
            idempotency_key: ev.idempotencyKey,
            status: initialStatus,
            trigger: "scheduler",
            scheduled_for: ctx.now().toISOString(),
            executed_at: null,
            paypal_ref: null,
            error: null,
          });
    } catch (e) {
      if (isUniqueViolation(e)) {
        r.skipped++; // another run claimed it concurrently
        continue;
      }
      throw e;
    }
    tasks = [...tasks.filter((t) => t.id !== task.id), task];

    if (step.action === "manual_review") {
      await ctx.db.update("agent_tasks", task.id, { status: "succeeded", executed_at: ctx.now().toISOString() });
      await recordActivity(ctx, {
        category: "manual_review_requested",
        invoice_id: invoice.id,
        client_id: invoice.client_id,
        trigger: "Collection scheduler",
        observed_condition: ev.reason,
        reasoning: "Automated reminders have run their course. A personal follow-up from you is more appropriate than another automated message.",
        proposed_action: `Review ${invoice.invoice_number} (${formatMoney(invoice.amount_due_cents, invoice.currency)} outstanding) with ${client?.name ?? "the client"}`,
        permission_result: `allow: ${perm.reason}`,
        approval_status: "pending",
        execution_status: "approval_required",
      });
      r.manualReviews++;
      r.details.push({ invoice: invoice.invoice_number, outcome: "manual_review", reason: ev.reason });
      continue;
    }

    if (perm.decision === "require_approval") {
      const note = reminderNote(step.tone, client?.name ?? "there", formatMoney(invoice.amount_due_cents, invoice.currency), invoice.due_date);
      await createApproval(ctx, {
        kind: step.action === "escalation" ? "escalation" : "send_reminder",
        source: "scheduler",
        summary: `${step.label}: ${invoice.invoice_number} · ${client?.name ?? ""} · ${formatMoney(invoice.amount_due_cents, invoice.currency)}`,
        reasoning: `${ev.reason} ${perm.reason}`,
        payload: { invoice_id: invoice.id, policy_id: policy?.id ?? null, step, tone: step.tone, note },
        invoice_id: invoice.id,
        client_id: invoice.client_id,
        agent_task_id: task.id,
        idempotency_key: ev.idempotencyKey,
      });
      r.approvalsRequested++;
      r.details.push({ invoice: invoice.invoice_number, outcome: "approval_requested", reason: perm.reason });
      continue;
    }

    try {
      const out = await remindInvoice(ctx, invoice.id, {
        actor: "scheduler",
        policy,
        step,
        taskId: task.id,
        trigger: "Collection scheduler",
        reasoning: ev.reason,
      });
      if (out.outcome === "sent") {
        r.executed++;
        r.details.push({ invoice: invoice.invoice_number, outcome: "reminder_sent", reason: ev.reason });
      } else {
        r.suppressed++;
        r.details.push({ invoice: invoice.invoice_number, outcome: "suppressed", reason: out.reason });
      }
    } catch (e) {
      r.failed++;
      r.details.push({ invoice: invoice.invoice_number, outcome: "failed", reason: e instanceof ServiceError ? e.message : String(e) });
    }
  }
  return r;
}
