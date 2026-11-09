import { describe, expect, it } from "vitest";
import { runCollectionCycle } from "@/lib/agent/scheduler";
import { decideApproval } from "@/lib/services/approvals";
import { at, makeCtx, sentInvoice } from "./helpers";

describe("scheduler execution", () => {
  it("sends an allowed reminder once and never duplicates it", async () => {
    const env = await makeCtx();
    const inv = await sentInvoice(env, { due: "2026-11-08" }); // 1 day overdue → overdue_1
    const first = await runCollectionCycle(env.ctx);
    expect(first.executed).toBe(1);
    expect(env.paypal.count("remind")).toBe(1);
    // Latest PayPal state was fetched before the reminder went out.
    const ops = env.paypal.calls.map((c) => c.op);
    expect(ops.lastIndexOf("fetch")).toBeLessThan(ops.lastIndexOf("remind"));

    const second = await runCollectionCycle(env.ctx);
    expect(second.executed).toBe(0);
    expect(env.paypal.count("remind")).toBe(1);
    const tasks = await env.db.list("agent_tasks", { invoice_id: inv.id });
    expect(tasks.filter((t) => t.status === "succeeded")).toHaveLength(1);
    expect((await env.db.list("agent_activity", { category: "reminder_sent" }))[0].execution_status).toBe("succeeded");
  });

  it("queues escalations for approval and executes only after approval", async () => {
    const env = await makeCtx();
    const inv = await sentInvoice(env, { due: "2026-11-01" }); // 8 days overdue → overdue_7 escalation
    const r = await runCollectionCycle(env.ctx);
    expect(r.approvalsRequested).toBe(1);
    expect(env.paypal.count("remind")).toBe(0);
    const [approval] = await env.db.list("approvals", { status: "pending" });
    expect(approval.kind).toBe("escalation");

    // Running again does not create a second approval.
    await runCollectionCycle(env.ctx);
    expect(await env.db.list("approvals", { status: "pending" })).toHaveLength(1);

    const done = await decideApproval(env.ctx, approval.id, "approve");
    expect(done.status).toBe("executed");
    expect(env.paypal.count("remind")).toBe(1);
    const t = await env.db.list("agent_tasks", { invoice_id: inv.id });
    expect(t[0].status).toBe("succeeded");
  });

  it("asks for approval for every reminder in assisted mode", async () => {
    const env = await makeCtx({ autonomy: "assisted" });
    await sentInvoice(env, { due: "2026-11-08" });
    const r = await runCollectionCycle(env.ctx);
    expect(r.executed).toBe(0);
    expect(r.approvalsRequested).toBe(1);
  });

  it("suppresses reminders for invoices PayPal reports as paid", async () => {
    const env = await makeCtx();
    const inv = await sentInvoice(env, { due: "2026-11-08" });
    env.paypal.pay(inv.paypal_invoice_id!, inv.total_cents); // paid at PayPal, local not yet updated
    const r = await runCollectionCycle(env.ctx);
    expect(r.executed).toBe(0);
    expect(r.suppressed).toBe(1);
    expect(env.paypal.count("remind")).toBe(0);
    expect((await env.db.require("invoices", inv.id)).status).toBe("paid");
  });

  it("blocks collection for disputed clients and logs it once per day", async () => {
    const env = await makeCtx();
    await sentInvoice(env, { due: "2026-11-08" });
    await env.db.update("clients", env.client.id, { dispute_open: true });
    const r = await runCollectionCycle(env.ctx);
    expect(r.blocked).toBe(1);
    await runCollectionCycle(env.ctx);
    expect(await env.db.list("agent_activity", { category: "action_blocked" })).toHaveLength(1);
    expect(env.paypal.count("remind")).toBe(0);
  });

  it("does nothing when the agent is paused", async () => {
    const env = await makeCtx();
    await sentInvoice(env, { due: "2026-11-08" });
    await env.db.updateProfile({ agent_paused: true });
    const r = await runCollectionCycle(env.ctx);
    expect(r.executed + r.approvalsRequested).toBe(0);
    expect(r.blocked).toBe(1);
  });

  it("records failures and retries the step on the next run", async () => {
    const env = await makeCtx();
    await sentInvoice(env, { due: "2026-11-08" });
    env.paypal.fail.add("remind");
    const r1 = await runCollectionCycle(env.ctx);
    expect(r1.failed).toBe(1);
    env.paypal.fail.clear();
    const r2 = await runCollectionCycle(env.ctx);
    expect(r2.executed).toBe(1);
    expect(env.paypal.count("remind")).toBe(2); // one failed attempt + one success, same idempotent request id
    const ids = env.paypal.calls.filter((c) => c.op === "remind").map((c) => c.requestId);
    expect(ids[0]).toBe(ids[1]);
  });

  it("walks the full ladder over time", async () => {
    const env = await makeCtx();
    const inv = await sentInvoice(env, { issue: "2026-10-20", due: "2026-11-12" });
    env.setNow(at("2026-11-09")); // pre-due
    expect((await runCollectionCycle(env.ctx)).executed).toBe(1);
    env.setNow(at("2026-11-13")); // 1 day overdue
    expect((await runCollectionCycle(env.ctx)).executed).toBe(1);
    env.setNow(at("2026-11-19")); // 7 days overdue → escalation needs approval
    expect((await runCollectionCycle(env.ctx)).approvalsRequested).toBe(1);
    env.setNow(at("2026-11-26")); // 14 days → manual review
    expect((await runCollectionCycle(env.ctx)).manualReviews).toBe(1);
    // The unanswered escalation is no longer pending as a step; manual review was logged.
    const reviews = await env.db.list("agent_activity", { category: "manual_review_requested", invoice_id: inv.id });
    expect(reviews).toHaveLength(1);
  });
});
