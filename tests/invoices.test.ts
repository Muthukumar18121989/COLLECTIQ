import { describe, expect, it } from "vitest";
import { UserDb } from "@/lib/db/user-db";
import { ServiceError } from "@/lib/services/context";
import { cancelInvoice, createInvoiceDraft, remindInvoice, sendInvoice, updateDraft } from "@/lib/services/invoices";
import { invoiceInputSchema } from "@/lib/validation";
import { TODAY, makeCtx, sentInvoice } from "./helpers";

const base = (clientId: string) => ({
  client_id: clientId,
  currency: "USD",
  issue_date: TODAY,
  due_date: "2026-11-16",
  items: [
    { description: "Branding", quantity: 1, unit_amount: 850 },
    { description: "Revisions", quantity: 2.5, unit_amount: 40 },
  ],
});

describe("invoice creation", () => {
  it("creates a draft with correct cent totals, a default policy and an audit entry", async () => {
    const env = await makeCtx();
    const inv = await createInvoiceDraft(env.ctx, base(env.client.id));
    expect(inv.status).toBe("draft");
    expect(inv.subtotal_cents).toBe(85000 + 10000);
    expect(inv.total_cents).toBe(95000);
    expect(inv.amount_due_cents).toBe(95000);
    expect(inv.policy_id).toBe(env.policy.id);
    expect(inv.paypal_invoice_id).toBeNull();
    expect(inv.invoice_number).toMatch(/^CIQ-\d{6}-[A-Z0-9]{3}$/);
    expect(await env.db.list("invoice_items", { invoice_id: inv.id })).toHaveLength(2);
    const act = await env.db.list("agent_activity", { invoice_id: inv.id });
    expect(act.map((a) => a.category)).toContain("invoice_created");
  });

  it("applies the configured tax rate", async () => {
    const env = await makeCtx();
    await env.db.updateProfile({ tax_rate_percent: 10 });
    const inv = await createInvoiceDraft(env.ctx, { ...base(env.client.id), items: [{ description: "x", quantity: 1, unit_amount: 100 }] });
    expect(inv.tax_cents).toBe(1000);
    expect(inv.total_cents).toBe(11000);
  });

  it("edits drafts but refuses to edit sent invoices", async () => {
    const env = await makeCtx();
    const inv = await createInvoiceDraft(env.ctx, base(env.client.id));
    const edited = await updateDraft(env.ctx, inv.id, { ...base(env.client.id), items: [{ description: "Only", quantity: 1, unit_amount: 10 }] });
    expect(edited.total_cents).toBe(1000);
    await sendInvoice(env.ctx, inv.id, { actor: "user" });
    await expect(updateDraft(env.ctx, inv.id, base(env.client.id))).rejects.toMatchObject({ code: "not_editable" });
  });
});

describe("invoice validation", () => {
  it("rejects missing line items, bad amounts and due dates before issue", () => {
    expect(invoiceInputSchema.safeParse({ ...base("c"), items: [] }).success).toBe(false);
    expect(invoiceInputSchema.safeParse({ ...base("c"), items: [{ description: "x", quantity: 1, unit_amount: -5 }] }).success).toBe(false);
    expect(invoiceInputSchema.safeParse({ ...base("c"), items: [{ description: "x", quantity: 1, unit_amount: 1.234 }] }).success).toBe(false);
    expect(invoiceInputSchema.safeParse({ ...base("c"), due_date: "2026-11-01" }).success).toBe(false);
    expect(invoiceInputSchema.safeParse({ ...base("c"), currency: "BTC" }).success).toBe(false);
    expect(invoiceInputSchema.safeParse(base("c")).success).toBe(true);
  });

  it("refuses to invoice a client that does not exist", async () => {
    const env = await makeCtx();
    await expect(createInvoiceDraft(env.ctx, base("no-such-client"))).rejects.toMatchObject({ code: "client_missing", status: 404 });
  });

  it("cannot see or touch another user's client", async () => {
    const env = await makeCtx();
    const otherId = "22222222-2222-4222-8222-222222222222";
    await env.store.insert("profiles", { ...(await env.db.profile()), id: otherId });
    // Same store, different user: scoping alone must hide the first user's client.
    const intruder = { ...env.ctx, db: new UserDb(env.store, otherId) };
    await expect(createInvoiceDraft(intruder, base(env.client.id))).rejects.toMatchObject({ code: "client_missing" });
  });
});

describe("sending through PayPal", () => {
  it("creates then sends at PayPal and stores the PayPal id separately", async () => {
    const env = await makeCtx();
    const inv = await sentInvoice(env);
    expect(inv.status).toBe("sent");
    expect(inv.paypal_invoice_id).toMatch(/^INV2-TEST-/);
    expect(inv.paypal_mode).toBe("sandbox");
    expect(inv.paypal_recipient_url).toContain("paypal.com");
    expect(env.paypal.count("create")).toBe(1);
    expect(env.paypal.count("send")).toBe(1);
  });

  it("does not mark the invoice sent when PayPal fails, and retries without duplicating", async () => {
    const env = await makeCtx();
    const draft = await createInvoiceDraft(env.ctx, base(env.client.id));
    env.paypal.fail.add("send");
    await expect(sendInvoice(env.ctx, draft.id, { actor: "user" })).rejects.toBeInstanceOf(ServiceError);
    const after = await env.db.require("invoices", draft.id);
    expect(after.status).toBe("draft");
    expect(after.paypal_invoice_id).not.toBeNull(); // created, not sent
    const failed = (await env.db.list("agent_activity", { invoice_id: draft.id })).find((a) => a.execution_status === "failed");
    expect(failed?.error).toContain("debug id debug-123");

    env.paypal.fail.clear();
    const ok = await sendInvoice(env.ctx, draft.id, { actor: "user" });
    expect(ok.status).toBe("sent");
    expect(env.paypal.count("create")).toBe(1); // reused the existing PayPal draft
  });

  it("requires approval when the agent tries to send", async () => {
    const env = await makeCtx();
    const draft = await createInvoiceDraft(env.ctx, base(env.client.id));
    await expect(sendInvoice(env.ctx, draft.id, { actor: "agent_chat" })).rejects.toMatchObject({ code: "send_requires_approval" });
    expect(env.paypal.count("create")).toBe(0);
  });
});

describe("reminders and cancellation", () => {
  it("prevents a second manual reminder on the same day", async () => {
    const env = await makeCtx();
    const inv = await sentInvoice(env);
    await remindInvoice(env.ctx, inv.id, { actor: "user", trigger: "test" });
    await expect(remindInvoice(env.ctx, inv.id, { actor: "user", trigger: "test" })).rejects.toMatchObject({ code: "duplicate_reminder" });
    expect(env.paypal.count("remind")).toBe(1);
  });

  it("re-checks PayPal and refuses to remind an invoice that was paid", async () => {
    const env = await makeCtx();
    const inv = await sentInvoice(env);
    env.paypal.pay(inv.paypal_invoice_id!, inv.total_cents);
    const out = await remindInvoice(env.ctx, inv.id, { actor: "user", trigger: "test" });
    expect(out.outcome).toBe("suppressed");
    expect(env.paypal.count("remind")).toBe(0);
    expect((await env.db.require("invoices", inv.id)).status).toBe("paid");
  });

  it("surfaces PayPal API failures on reminders", async () => {
    const env = await makeCtx();
    const inv = await sentInvoice(env);
    env.paypal.fail.add("remind");
    await expect(remindInvoice(env.ctx, inv.id, { actor: "user", trigger: "test" })).rejects.toMatchObject({ code: "paypal_error" });
    const tasks = await env.db.list("agent_tasks", { invoice_id: inv.id });
    expect(tasks[0].status).toBe("failed");
  });

  it("cancels at PayPal and blocks further reminders", async () => {
    const env = await makeCtx();
    const inv = await sentInvoice(env);
    const c = await cancelInvoice(env.ctx, inv.id, { actor: "user" });
    expect(c.status).toBe("cancelled");
    expect(c.amount_due_cents).toBe(0);
    expect(env.paypal.count("cancel")).toBe(1);
    await expect(remindInvoice(env.ctx, inv.id, { actor: "user", trigger: "test" })).rejects.toMatchObject({ code: "invoice_closed" });
  });
});
