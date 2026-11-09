import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "@/lib/agent/default-policy";
import { evaluateInvoice, idempotencyKeyFor } from "@/lib/agent/policy-engine";
import type { AgentTask, CollectionPolicy, Invoice } from "@/lib/types";
import { at } from "./helpers";

const policy: CollectionPolicy = { ...DEFAULT_POLICY, id: "p1", user_id: "u", is_demo: false, created_at: "", updated_at: "" };
const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "inv1",
    status: "sent",
    due_date: "2026-11-10",
    amount_due_cents: 50000,
    total_cents: 50000,
    amount_paid_cents: 0,
    policy_id: "p1",
    ...over,
  }) as Invoice;
const task = (over: Partial<AgentTask>): AgentTask =>
  ({ id: crypto.randomUUID(), invoice_id: "inv1", kind: "reminder", status: "succeeded", executed_at: "2026-11-01T00:00:00Z", updated_at: "", ...over }) as AgentTask;

describe("reminder eligibility", () => {
  it("does nothing before the first step is due", () => {
    const r = evaluateInvoice({ invoice: invoice({ due_date: "2026-11-20" }), policy, tasks: [], now: at("2026-11-09") });
    expect(r.action).toBe("none");
    expect(r.reason).toMatch(/not due yet/);
  });

  it("fires the pre-due friendly reminder 3 days before due", () => {
    const r = evaluateInvoice({ invoice: invoice({ due_date: "2026-11-12" }), policy, tasks: [], now: at("2026-11-09") });
    expect(r.action).toBe("reminder");
    expect(r.step?.id).toBe("pre_due_3");
    expect(r.idempotencyKey).toBe(idempotencyKeyFor("inv1", "pre_due_3"));
  });

  it("picks only the latest due step, never a burst of stale ones", () => {
    const r = evaluateInvoice({ invoice: invoice({ due_date: "2026-11-01" }), policy, tasks: [], now: at("2026-11-09") });
    expect(r.step?.id).toBe("overdue_7");
    expect(r.action).toBe("escalation");
    const late = evaluateInvoice({ invoice: invoice({ due_date: "2026-10-20" }), policy, tasks: [], now: at("2026-11-09") });
    expect(late.action).toBe("manual_review");
  });

  it("treats paid and cancelled invoices as closed", () => {
    for (const status of ["paid", "cancelled", "refunded"] as const) {
      const r = evaluateInvoice({ invoice: invoice({ status }), policy, tasks: [], now: at("2026-11-12") });
      expect(r.action).toBe("none");
      expect(r.closed).toBe(true);
    }
  });

  it("ignores drafts and paused policies", () => {
    expect(evaluateInvoice({ invoice: invoice({ status: "draft" }), policy, tasks: [], now: at("2026-11-12") }).action).toBe("none");
    expect(evaluateInvoice({ invoice: invoice(), policy: { ...policy, status: "paused" }, tasks: [], now: at("2026-11-12") }).action).toBe("none");
  });
});

describe("duplicate reminder prevention", () => {
  it("does not repeat a step that already ran or is awaiting approval", () => {
    const now = at("2026-11-11"); // 1 day overdue
    expect(evaluateInvoice({ invoice: invoice(), policy, tasks: [task({ step_id: "overdue_1" })], now }).action).toBe("none");
    expect(evaluateInvoice({ invoice: invoice(), policy, tasks: [task({ step_id: "overdue_1", status: "pending_approval" })], now }).action).toBe("none");
  });

  it("allows retrying a step whose previous attempt failed", () => {
    const r = evaluateInvoice({ invoice: invoice(), policy, tasks: [task({ step_id: "overdue_1", status: "failed" })], now: at("2026-11-11") });
    expect(r.step?.id).toBe("overdue_1");
  });

  it("respects the minimum gap between reminders", () => {
    const r = evaluateInvoice({
      invoice: invoice(),
      policy,
      tasks: [task({ step_id: "pre_due_3", executed_at: "2026-11-10T09:00:00Z" })],
      now: at("2026-11-11"),
    });
    expect(r.action).toBe("none");
    expect(r.reason).toMatch(/under 2 days/);
  });

  it("respects the maximum number of reminders", () => {
    const tasks = [1, 2, 3, 4].map((n) => task({ step_id: `manual_${n}`, executed_at: "2026-10-01T00:00:00Z" }));
    const r = evaluateInvoice({ invoice: invoice(), policy, tasks, now: at("2026-11-11") });
    expect(r.reason).toMatch(/Maximum of 4/);
  });
});
