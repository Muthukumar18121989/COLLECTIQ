import { describe, expect, it } from "vitest";
import { runCollectionCycle } from "@/lib/agent/scheduler";
import type { WebhookEventBody } from "@/lib/paypal/types";
import { processWebhook } from "@/lib/services/webhooks";
import { makeCtx, sentInvoice } from "./helpers";

const event = (id: string, type: string, invoiceId: string): WebhookEventBody => ({
  id,
  event_type: type,
  resource_type: "invoices",
  resource: { invoice: { id: invoiceId, status: "PAID", detail: { currency_code: "USD" } } },
});

async function setup() {
  const env = await makeCtx();
  const inv = await sentInvoice(env, { due: "2026-11-01" });
  const run = (ev: WebhookEventBody, verify: "SUCCESS" | "FAILURE" = "SUCCESS") =>
    processWebhook({ store: env.store, event: ev, verify: async () => verify, gateways: env.ctx.gateways, now: env.ctx.now });
  return { env, inv, run };
}

describe("webhook verification", () => {
  it("rejects events that fail PayPal signature verification and changes nothing", async () => {
    const { env, inv, run } = await setup();
    env.paypal.pay(inv.paypal_invoice_id!, inv.total_cents);
    const r = await run(event("WH-1", "INVOICING.INVOICE.PAID", inv.paypal_invoice_id!), "FAILURE");
    expect(r.httpStatus).toBe(400);
    expect(r.outcome).toBe("rejected");
    expect((await env.db.require("invoices", inv.id)).status).toBe("sent");
    const [row] = await env.store.list("webhook_events");
    expect(row.verification_status).toBe("FAILURE");
  });

  it("returns 503 (so PayPal retries) when verification itself errors", async () => {
    const { env, inv } = await setup();
    const r = await processWebhook({
      store: env.store,
      event: event("WH-X", "INVOICING.INVOICE.PAID", inv.paypal_invoice_id!),
      verify: async () => {
        throw new Error("network");
      },
      gateways: env.ctx.gateways,
    });
    expect(r.httpStatus).toBe(503);
  });

  it("rejects malformed bodies", async () => {
    const { env } = await setup();
    const r = await processWebhook({ store: env.store, event: {} as WebhookEventBody, verify: async () => "SUCCESS", gateways: env.ctx.gateways });
    expect(r.httpStatus).toBe(400);
  });
});

describe("webhook processing", () => {
  it("uses PayPal's canonical state: a PAID event with a balance left is only partially paid", async () => {
    const { env, inv, run } = await setup();
    env.paypal.pay(inv.paypal_invoice_id!, 30000); // of 85000
    const r = await run(event("WH-2", "INVOICING.INVOICE.PAID", inv.paypal_invoice_id!));
    expect(r.outcome).toBe("processed");
    const after = await env.db.require("invoices", inv.id);
    expect(after.status).toBe("partially_paid");
    expect(after.amount_paid_cents).toBe(30000);
    expect(after.amount_due_cents).toBe(55000);
  });

  it("marks fully paid only when PayPal reports no outstanding balance, and suppresses pending reminders", async () => {
    const { env, inv, run } = await setup();
    await runCollectionCycle(env.ctx); // creates an escalation approval
    expect(await env.db.list("approvals", { status: "pending" })).toHaveLength(1);

    env.paypal.pay(inv.paypal_invoice_id!, inv.total_cents);
    await run(event("WH-3", "INVOICING.INVOICE.PAID", inv.paypal_invoice_id!));
    const after = await env.db.require("invoices", inv.id);
    expect(after.status).toBe("paid");
    expect(after.paid_at).not.toBeNull();
    expect(await env.db.list("approvals", { status: "pending" })).toHaveLength(0);
    expect((await env.db.list("agent_activity", { category: "payment_received" })).length).toBe(1);

    const r = await runCollectionCycle(env.ctx);
    expect(r.executed + r.approvalsRequested).toBe(0);
    expect(env.paypal.count("remind")).toBe(0);
  });

  it("deduplicates repeated deliveries of the same event", async () => {
    const { env, inv, run } = await setup();
    env.paypal.pay(inv.paypal_invoice_id!, inv.total_cents);
    const ev = event("WH-4", "INVOICING.INVOICE.PAID", inv.paypal_invoice_id!);
    expect((await run(ev)).outcome).toBe("processed");
    expect((await run(ev)).outcome).toBe("duplicate");
    expect(await env.store.list("webhook_events")).toHaveLength(1);
    expect(await env.db.list("agent_activity", { category: "payment_received" })).toHaveLength(1);
  });

  it("returns 500 when processing fails, then succeeds on PayPal's retry", async () => {
    const { env, inv, run } = await setup();
    env.paypal.pay(inv.paypal_invoice_id!, inv.total_cents);
    env.paypal.fail.add("fetch");
    const ev = event("WH-5", "INVOICING.INVOICE.PAID", inv.paypal_invoice_id!);
    const first = await run(ev);
    expect(first.httpStatus).toBe(500);
    expect((await env.db.require("invoices", inv.id)).status).toBe("sent");
    env.paypal.fail.clear();
    const retry = await run(ev);
    expect(retry.outcome).toBe("processed");
    expect((await env.db.require("invoices", inv.id)).status).toBe("paid");
  });

  it("handles cancellations and ignores unknown invoices and event types", async () => {
    const { env, inv, run } = await setup();
    env.paypal.remote.get(inv.paypal_invoice_id!)!.status = "CANCELLED";
    await run(event("WH-6", "INVOICING.INVOICE.CANCELLED", inv.paypal_invoice_id!));
    expect((await env.db.require("invoices", inv.id)).status).toBe("cancelled");
    expect((await run(event("WH-7", "INVOICING.INVOICE.PAID", "INV2-UNKNOWN"))).outcome).toBe("ignored");
    expect((await run(event("WH-8", "PAYMENT.CAPTURE.COMPLETED", inv.paypal_invoice_id!))).outcome).toBe("ignored");
  });
});
