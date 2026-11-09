import { describe, expect, it } from "vitest";
import { runDemoAgent } from "@/lib/agent/demo-agent";
import { runCollectionCycle } from "@/lib/agent/scheduler";
import { executeTool } from "@/lib/agent/tools";
import { decideApproval } from "@/lib/services/approvals";
import { processWebhook } from "@/lib/services/webhooks";
import { at, makeCtx } from "./helpers";

describe("complete invoice lifecycle", () => {
  it("AI request → approved draft → PayPal send → autopilot reminder → verified payment webhook → collection stops", async () => {
    const env = await makeCtx();

    // 1. Natural-language request produces an approval, not an invoice.
    const reply = await runDemoAgent(env.ctx, "Create an invoice for Sarah for $850 for branding work, due in seven days");
    expect(reply.approvals).toHaveLength(1);
    expect(await env.db.list("invoices")).toHaveLength(0);

    // 2. User approves → draft created by the backend.
    const created = await decideApproval(env.ctx, reply.approvals[0].id, "approve");
    const invoiceId = String(created.result!.invoice_id);
    const draft = await env.db.require("invoices", invoiceId);
    expect(draft).toMatchObject({ status: "draft", total_cents: 85000, due_date: "2026-11-16", created_by: "agent" });

    // 3. Agent proposes sending; user approves; PayPal confirms.
    const send = await executeTool(env.ctx, "send_invoice", { invoice_id: invoiceId });
    expect(env.paypal.count("send")).toBe(0);
    await decideApproval(env.ctx, send.approval!.id, "approve");
    const sent = await env.db.require("invoices", invoiceId);
    expect(sent.status).toBe("sent");
    expect(sent.paypal_invoice_id).toMatch(/^INV2-/);

    // 4. Autopilot sends the pre-due reminder on its own (policy-driven, low risk).
    env.setNow(at("2026-11-13"));
    expect((await runCollectionCycle(env.ctx)).executed).toBe(1);

    // 5. Client pays at PayPal; verified webhook arrives.
    env.paypal.pay(sent.paypal_invoice_id!, 85000);
    const wh = await processWebhook({
      store: env.store,
      event: { id: "WH-LIFE", event_type: "INVOICING.INVOICE.PAID", resource: { invoice: { id: sent.paypal_invoice_id!, status: "PAID", detail: { currency_code: "USD" } } } },
      verify: async () => "SUCCESS",
      gateways: env.ctx.gateways,
      now: env.ctx.now,
    });
    expect(wh.outcome).toBe("processed");
    expect((await env.db.require("invoices", invoiceId)).status).toBe("paid");

    // 6. No more reminders, ever.
    env.setNow(at("2026-11-30"));
    const after = await runCollectionCycle(env.ctx);
    expect(after.executed + after.approvalsRequested + after.manualReviews).toBe(0);
    expect(env.paypal.count("remind")).toBe(1);

    // 7. Every step is in the audit log.
    const cats = (await env.db.list("agent_activity", { invoice_id: invoiceId })).map((a) => a.category);
    for (const c of ["invoice_created", "invoice_sent", "reminder_sent", "webhook_received", "payment_received"]) expect(cats).toContain(c);
  });

  it("the AI cannot create invoices for unknown clients or with mismatched currency", async () => {
    const env = await makeCtx();
    const unknown = await executeTool(env.ctx, "create_invoice_draft", { client_id: "nope", description: "x", amount: 10 });
    expect(unknown.result.error).toBeDefined();
    const eur = await executeTool(env.ctx, "create_invoice_draft", { client_id: env.client.id, description: "x", amount: 10, currency: "EUR" });
    expect(String(eur.result.error)).toMatch(/billed in USD/);
    const noAmount = await executeTool(env.ctx, "create_invoice_draft", { client_id: env.client.id, description: "x" });
    expect(String(noAmount.result.error)).toMatch(/Ask the user/);
    expect(await env.db.list("approvals")).toHaveLength(0);
  });

  it("rejected approvals change nothing", async () => {
    const env = await makeCtx();
    const reply = await runDemoAgent(env.ctx, "Create an invoice for Sarah for $120 for a logo tweak");
    const rej = await decideApproval(env.ctx, reply.approvals[0].id, "reject");
    expect(rej.status).toBe("rejected");
    expect(await env.db.list("invoices")).toHaveLength(0);
    await expect(decideApproval(env.ctx, reply.approvals[0].id, "approve")).rejects.toMatchObject({ code: "not_pending" });
  });
});
