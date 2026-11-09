import { describe, expect, it } from "vitest";
import { type PermissionContext, checkPermission } from "@/lib/agent/permissions";

const openInvoice = { status: "sent" as const, dispute_open: false, collection_paused: false, amount_due_cents: 10000 };
const client = { dispute_open: false, collection_paused: false };
const policy = { status: "active" as const, auto_execute: true };
const reminderStep = { action: "reminder" as const, requires_approval: false };

const ctx = (over: Partial<PermissionContext>): PermissionContext => ({
  op: "send_reminder",
  actor: "scheduler",
  autonomyMode: "policy_driven",
  agentPaused: false,
  approved: false,
  invoice: openInvoice,
  client,
  policy,
  step: reminderStep,
  ...over,
});

describe("permission service", () => {
  it("never allows money movement, even when 'approved'", () => {
    for (const op of ["issue_refund", "send_payment", "modify_payment_amount"] as const) {
      expect(checkPermission(ctx({ op, actor: "user", approved: true })).decision).toBe("deny");
    }
  });

  it("lets the scheduler send low-risk reminders allowed by an active policy", () => {
    expect(checkPermission(ctx({})).decision).toBe("allow");
  });

  it("requires approval in assisted mode, when auto-execute is off, or when the step says so", () => {
    expect(checkPermission(ctx({ autonomyMode: "assisted" })).decision).toBe("require_approval");
    expect(checkPermission(ctx({ policy: { status: "active", auto_execute: false } })).decision).toBe("require_approval");
    expect(checkPermission(ctx({ step: { action: "reminder", requires_approval: true } })).decision).toBe("require_approval");
  });

  it("always requires approval for escalations by default", () => {
    const r = checkPermission(ctx({ op: "escalation", step: { action: "escalation", requires_approval: false } }));
    expect(r.decision).toBe("require_approval");
    expect(checkPermission(ctx({ op: "escalation", approved: true })).decision).toBe("allow");
  });

  it("blocks reminders for paid, cancelled, draft, disputed or paused invoices", () => {
    expect(checkPermission(ctx({ invoice: { ...openInvoice, status: "paid" } })).code).toBe("invoice_closed");
    expect(checkPermission(ctx({ invoice: { ...openInvoice, status: "cancelled" } })).code).toBe("invoice_closed");
    expect(checkPermission(ctx({ invoice: { ...openInvoice, status: "draft" } })).code).toBe("invoice_not_sent");
    expect(checkPermission(ctx({ client: { ...client, dispute_open: true } })).code).toBe("dispute_open");
    expect(checkPermission(ctx({ invoice: { ...openInvoice, collection_paused: true } })).code).toBe("collection_paused");
    expect(checkPermission(ctx({ policy: { status: "paused", auto_execute: true } })).code).toBe("policy_inactive");
  });

  it("approval cannot override a hard deny", () => {
    expect(checkPermission(ctx({ approved: true, invoice: { ...openInvoice, status: "paid" } })).decision).toBe("deny");
    expect(checkPermission(ctx({ approved: true, client: { ...client, dispute_open: true } })).decision).toBe("deny");
  });

  it("stops all agent activity when the agent is paused", () => {
    expect(checkPermission(ctx({ agentPaused: true })).code).toBe("agent_paused");
    expect(checkPermission(ctx({ agentPaused: true, actor: "agent_chat", op: "send_invoice", invoice: { ...openInvoice, status: "draft" } })).code).toBe("agent_paused");
    // The user is never blocked by the agent pause.
    expect(checkPermission(ctx({ agentPaused: true, actor: "user" })).decision).toBe("allow");
  });

  it("requires approval for chat-initiated writes", () => {
    expect(checkPermission(ctx({ actor: "agent_chat" })).decision).toBe("require_approval");
    expect(checkPermission(ctx({ actor: "agent_chat", op: "create_invoice_draft" })).decision).toBe("require_approval");
    expect(checkPermission(ctx({ actor: "agent_chat", op: "send_invoice", invoice: { ...openInvoice, status: "draft" } })).decision).toBe("require_approval");
    expect(checkPermission(ctx({ actor: "agent_chat", op: "cancel_invoice" })).decision).toBe("require_approval");
  });

  it("users may act directly", () => {
    expect(checkPermission(ctx({ actor: "user", op: "send_invoice", invoice: { ...openInvoice, status: "draft" } })).decision).toBe("allow");
    expect(checkPermission(ctx({ actor: "user", op: "send_invoice" })).code).toBe("not_draft");
  });
});
