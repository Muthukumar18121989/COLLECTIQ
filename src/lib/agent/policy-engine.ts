import { daysBetween, todayISO } from "@/lib/dates";
import type { AgentTask, CollectionPolicy, Invoice, PolicyStep } from "@/lib/types";

// The policy engine decides *what the policy says should happen next* for one
// invoice. It does not check permissions (see permissions.ts) and does not
// call PayPal (see scheduler.ts). Pure and deterministic for testing.

export const COLLECTIBLE = new Set(["sent", "unpaid", "partially_paid", "overdue"]);

/** Task statuses that mean a step has been handled and must not be repeated. */
const HANDLED = new Set(["succeeded", "pending_approval", "executing", "skipped", "blocked", "suppressed"]);

export interface PolicyEvaluation {
  action: "none" | PolicyStep["action"];
  step: PolicyStep | null;
  reason: string;
  idempotencyKey: string | null;
  daysPastDue: number;
  /** True when the invoice is closed and any pending work should be suppressed. */
  closed: boolean;
}

export function idempotencyKeyFor(invoiceId: string, stepId: string) {
  return `invoice:${invoiceId}:step:${stepId}`;
}

export function evaluateInvoice(input: {
  invoice: Invoice;
  policy: CollectionPolicy | null;
  tasks: AgentTask[];
  now?: Date;
}): PolicyEvaluation {
  const { invoice, policy, tasks } = input;
  const today = todayISO(input.now);
  const daysPastDue = daysBetween(invoice.due_date, today);
  const none = (reason: string, closed = false): PolicyEvaluation => ({
    action: "none",
    step: null,
    reason,
    idempotencyKey: null,
    daysPastDue,
    closed,
  });

  if (["paid", "cancelled", "refunded"].includes(invoice.status)) {
    return none(`Invoice is ${invoice.status}; no collection needed.`, true);
  }
  if (!COLLECTIBLE.has(invoice.status)) return none(`Invoice status "${invoice.status}" is not collectible.`);
  if (invoice.amount_due_cents <= 0) return none("No outstanding balance.", true);
  if (!policy) return none("No collection policy assigned.");
  if (policy.status !== "active") return none(`Policy "${policy.name}" is paused.`);

  const invoiceTasks = tasks.filter((t) => t.invoice_id === invoice.id);
  const handledSteps = new Set(invoiceTasks.filter((t) => HANDLED.has(t.status)).map((t) => t.step_id));

  const dueSteps = [...policy.steps]
    .filter((s) => s.offset_days <= daysPastDue)
    .sort((a, b) => b.offset_days - a.offset_days);
  if (dueSteps.length === 0) {
    const next = [...policy.steps].sort((a, b) => a.offset_days - b.offset_days)[0];
    return none(next ? `Next step "${next.label}" is not due yet.` : "Policy has no steps.");
  }
  // Only the most recent due step is considered, so a late start never fires a
  // burst of stale reminders.
  const step = dueSteps[0];
  if (handledSteps.has(step.id)) return none(`Step "${step.label}" has already been handled.`);

  if (step.action !== "manual_review") {
    const sent = invoiceTasks.filter(
      (t) => (t.kind === "reminder" || t.kind === "escalation") && t.status === "succeeded",
    );
    if (sent.length >= policy.max_reminders_per_invoice) {
      return none(`Maximum of ${policy.max_reminders_per_invoice} reminders reached.`);
    }
    const last = sent
      .map((t) => t.executed_at ?? t.updated_at)
      .sort()
      .at(-1);
    if (last && daysBetween(last, today) < policy.min_days_between_reminders) {
      return none(`Last reminder was under ${policy.min_days_between_reminders} days ago.`);
    }
  }

  return {
    action: step.action,
    step,
    reason:
      daysPastDue < 0
        ? `Due in ${-daysPastDue} day(s); policy step "${step.label}" applies.`
        : daysPastDue === 0
          ? `Due today; policy step "${step.label}" applies.`
          : `${daysPastDue} day(s) overdue; policy step "${step.label}" applies.`,
    idempotencyKey: idempotencyKeyFor(invoice.id, step.id),
    daysPastDue,
    closed: false,
  };
}
