import type { AutonomyMode, Client, CollectionPolicy, Invoice, PolicyStep } from "@/lib/types";

// The permission service. It is pure, deterministic and independent of any AI
// output: Claude can *propose* operations, but only this function decides
// whether they may run. It is re-evaluated at execution time, every time.

export type Operation =
  | "create_invoice_draft"
  | "send_invoice"
  | "send_reminder"
  | "escalation"
  | "manual_review"
  | "cancel_invoice"
  | "pause_collection"
  | "resume_collection"
  | "update_policy"
  | "issue_refund"
  | "send_payment"
  | "modify_payment_amount";

export type Actor = "user" | "agent_chat" | "scheduler";

export interface PermissionContext {
  op: Operation;
  actor: Actor;
  autonomyMode: AutonomyMode;
  agentPaused: boolean;
  /** True only when a human explicitly approved this exact operation. */
  approved: boolean;
  invoice?: Pick<Invoice, "status" | "dispute_open" | "collection_paused" | "amount_due_cents"> | null;
  client?: Pick<Client, "dispute_open" | "collection_paused"> | null;
  policy?: Pick<CollectionPolicy, "status" | "auto_execute"> | null;
  step?: Pick<PolicyStep, "requires_approval" | "action"> | null;
}

export type PermissionDecision = "allow" | "require_approval" | "deny";

export interface PermissionResult {
  decision: PermissionDecision;
  code: string;
  reason: string;
}

const deny = (code: string, reason: string): PermissionResult => ({ decision: "deny", code, reason });
const allow = (code: string, reason: string): PermissionResult => ({ decision: "allow", code, reason });
const ask = (code: string, reason: string): PermissionResult => ({ decision: "require_approval", code, reason });

const CLOSED = new Set(["paid", "cancelled", "refunded"]);

function base(ctx: PermissionContext): PermissionResult {
  const { op, actor, invoice, client } = ctx;

  // 1. Hard limits: COLLECTIQ never moves money or changes amounts on its own.
  if (op === "issue_refund" || op === "send_payment" || op === "modify_payment_amount") {
    return deny("money_movement_forbidden", "COLLECTIQ never sends payments, issues refunds or changes payment amounts.");
  }

  const isAgent = actor !== "user";
  if (isAgent && ctx.agentPaused && op !== "pause_collection") {
    return deny("agent_paused", "All agent activity is paused in Settings.");
  }

  switch (op) {
    case "create_invoice_draft":
      return isAgent
        ? ask("agent_creates_draft", "The agent prepared an invoice draft; you confirm before it is saved.")
        : allow("user_action", "You created this draft.");

    case "send_invoice": {
      if (!invoice) return deny("invoice_missing", "Invoice not found.");
      if (invoice.status !== "draft") return deny("not_draft", `Only draft invoices can be sent (status is ${invoice.status}).`);
      return isAgent
        ? ask("send_requires_approval", "Sending an invoice to a client always needs your approval.")
        : allow("user_action", "You chose to send this invoice.");
    }

    case "cancel_invoice": {
      if (!invoice) return deny("invoice_missing", "Invoice not found.");
      if (CLOSED.has(invoice.status)) return deny("invoice_closed", `Invoice is already ${invoice.status}.`);
      return isAgent
        ? ask("cancel_requires_approval", "Cancelling an invoice needs your approval.")
        : allow("user_action", "You chose to cancel this invoice.");
    }

    case "pause_collection":
    case "resume_collection":
    case "update_policy":
      return isAgent
        ? ask("policy_change_requires_approval", "Changes to collection settings proposed by the agent need your approval.")
        : allow("user_action", "You changed collection settings.");

    case "send_reminder":
    case "escalation":
    case "manual_review": {
      if (!invoice) return deny("invoice_missing", "Invoice not found.");
      if (CLOSED.has(invoice.status)) return deny("invoice_closed", `No reminders for ${invoice.status} invoices.`);
      if (invoice.status === "draft") return deny("invoice_not_sent", "The invoice has not been sent yet.");
      if (invoice.amount_due_cents <= 0) return deny("nothing_due", "Nothing is outstanding on this invoice.");
      if (invoice.dispute_open || client?.dispute_open) {
        return deny("dispute_open", "A dispute or client objection is recorded, so collection is stopped.");
      }
      if (op === "manual_review") return allow("notify_only", "Manual review only notifies you; nothing is sent to the client.");

      if (actor === "user") return allow("user_action", "You chose to send this reminder.");
      if (invoice.collection_paused || client?.collection_paused) {
        return deny("collection_paused", "Collection is paused for this invoice or client.");
      }
      if (actor === "agent_chat") return ask("chat_reminder_requires_approval", "Reminders proposed in chat need your approval.");

      // Scheduler path.
      if (!ctx.policy || ctx.policy.status !== "active") return deny("policy_inactive", "The collection policy is paused or missing.");
      if (op === "escalation") return ask("escalation_requires_approval", "Escalations always require your approval.");
      if (ctx.step?.requires_approval) return ask("step_requires_approval", "This policy step is configured to require approval.");
      if (ctx.autonomyMode === "assisted") return ask("assisted_mode", "Assisted mode: the agent prepares reminders for you to approve.");
      if (!ctx.policy.auto_execute) return ask("auto_execute_off", "Automatic execution is turned off for this policy.");
      return allow("policy_allows", "Low-risk reminder allowed by your active collection policy.");
    }
  }
}

export function checkPermission(ctx: PermissionContext): PermissionResult {
  const result = base(ctx);
  if (result.decision === "require_approval" && ctx.approved) {
    return allow("approved", `Approved by you. (${result.reason})`);
  }
  return result;
}
