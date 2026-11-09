import { DEFAULT_POLICY } from "@/lib/agent/default-policy";
import { addDays, todayISO } from "@/lib/dates";
import type { Currency, InvoiceStatus } from "@/lib/types";
import type { UserDb } from "./user-db";

// DEMO DATA. Every row created here carries is_demo = true and every "sent"
// invoice has paypal_mode = 'demo' with a DEMO- prefixed reference, so it can
// never be mistaken for a real PayPal Sandbox record.

interface SeedInvoice {
  client: string;
  project: string;
  items: Array<[string, number, number]>; // description, qty, unit dollars
  issueOffset: number;
  dueOffset: number;
  status: InvoiceStatus;
  paidDollars?: number;
  paidOffset?: number;
}

const CLIENTS = [
  { key: "sarah", name: "Sarah Chen", email: "sarah@bloomstudio.example", company: "Bloom Studio", phone: "+1 415 555 0142" },
  { key: "alex", name: "Alex Rivera", email: "alex@northwindlabs.example", company: "Northwind Labs", phone: null },
  { key: "maya", name: "Maya Patel", email: "maya@lumencoffee.example", company: "Lumen Coffee Co.", phone: "+1 628 555 0199" },
  { key: "jordan", name: "Jordan Blake", email: "jordan@atlasfitness.example", company: "Atlas Fitness", phone: null },
  { key: "elena", name: "Elena Novak", email: "elena@quillpress.example", company: "Quill Press", phone: null },
] as const;

const INVOICES: SeedInvoice[] = [
  { client: "sarah", project: "Brand identity refresh", items: [["Logo system and brand guidelines", 1, 1500]], issueOffset: -40, dueOffset: -26, status: "sent" },
  { client: "sarah", project: "Brand identity refresh", items: [["Social media template kit", 1, 650]], issueOffset: -12, dueOffset: 2, status: "sent" },
  { client: "alex", project: "SaaS dashboard redesign", items: [["UX audit", 1, 900], ["High-fidelity dashboard screens", 12, 120]], issueOffset: -24, dueOffset: -10, status: "sent" },
  { client: "alex", project: "SaaS dashboard redesign", items: [["Design system components", 1, 1800]], issueOffset: -70, dueOffset: -56, status: "paid", paidDollars: 1800, paidOffset: -50 },
  { client: "maya", project: "Menu and packaging design", items: [["Menu design", 1, 450]], issueOffset: -18, dueOffset: -4, status: "sent" },
  { client: "maya", project: "Menu and packaging design", items: [["Packaging concepts", 3, 300]], issueOffset: -30, dueOffset: -16, status: "paid", paidDollars: 900, paidOffset: -9 },
  { client: "jordan", project: "Website UI kit", items: [["Landing page design", 1, 1200], ["Mobile responsive variants", 1, 400]], issueOffset: -20, dueOffset: -2, status: "partially_paid", paidDollars: 800, paidOffset: -5 },
  { client: "jordan", project: "Website UI kit", items: [["Icon set", 1, 350]], issueOffset: -3, dueOffset: 11, status: "sent" },
  { client: "elena", project: "Book cover series", items: [["Cover design", 2, 600]], issueOffset: -100, dueOffset: -86, status: "paid", paidDollars: 1200, paidOffset: -80 },
  { client: "elena", project: "Book cover series", items: [["Cover design — volume 3", 1, 600]], issueOffset: -1, dueOffset: 14, status: "draft" },
  { client: "maya", project: "Menu and packaging design", items: [["Seasonal poster", 1, 300]], issueOffset: -35, dueOffset: -21, status: "cancelled" },
];

export async function seedDemoData(db: UserDb, now = new Date()) {
  const today = todayISO(now);
  const existing = await db.list("clients", { is_demo: true });
  if (existing.length > 0) return { created: false };

  const policy =
    (await db.findOne("collection_policies", { is_default: true })) ??
    (await db.insert("collection_policies", { ...DEFAULT_POLICY, is_demo: true }));

  const clientIds: Record<string, string> = {};
  const projectIds: Record<string, string> = {};
  for (const c of CLIENTS) {
    const row = await db.insert("clients", {
      name: c.name,
      email: c.email,
      company: c.company,
      phone: c.phone,
      currency: "USD" as Currency,
      collection_paused: false,
      dispute_open: false,
      dispute_note: null,
      notes: "Demo client (fictional).",
      is_demo: true,
    });
    clientIds[c.key] = row.id;
  }

  let n = 1001;
  for (const inv of INVOICES) {
    const pKey = `${inv.client}:${inv.project}`;
    if (!projectIds[pKey]) {
      const p = await db.insert("projects", {
        client_id: clientIds[inv.client],
        name: inv.project,
        status: "active",
        is_demo: true,
      });
      projectIds[pKey] = p.id;
    }
    const subtotal = inv.items.reduce((s, [, q, u]) => s + q * u * 100, 0);
    const paid = (inv.paidDollars ?? 0) * 100;
    const status = inv.status;
    const isSent = status !== "draft";
    const number = `DEMO-${n++}`;
    const invoice = await db.insert("invoices", {
      client_id: clientIds[inv.client],
      project_id: projectIds[pKey],
      policy_id: policy.id,
      invoice_number: number,
      currency: "USD",
      issue_date: addDays(today, inv.issueOffset),
      due_date: addDays(today, inv.dueOffset),
      status,
      subtotal_cents: subtotal,
      tax_cents: 0,
      total_cents: subtotal,
      amount_paid_cents: paid,
      amount_due_cents: status === "cancelled" ? 0 : subtotal - paid,
      note: null,
      collection_paused: false,
      dispute_open: false,
      paypal_mode: isSent ? "demo" : null,
      paypal_invoice_id: isSent ? `DEMO-INV-${number}` : null,
      paypal_status: isSent ? demoPayPalStatus(status) : null,
      paypal_recipient_url: null,
      paypal_invoicer_url: null,
      paypal_last_synced_at: null,
      sent_at: isSent ? `${addDays(today, inv.issueOffset)}T15:00:00.000Z` : null,
      paid_at: status === "paid" && inv.paidOffset != null ? `${addDays(today, inv.paidOffset)}T12:00:00.000Z` : null,
      cancelled_at: status === "cancelled" ? `${addDays(today, inv.issueOffset + 5)}T12:00:00.000Z` : null,
      is_demo: true,
      created_by: "user",
    });
    let pos = 0;
    for (const [description, quantity, unit] of inv.items) {
      await db.insert("invoice_items", {
        invoice_id: invoice.id,
        description,
        quantity,
        unit_amount_cents: unit * 100,
        position: pos++,
      });
    }
    if (isSent) {
      await db.insert("agent_activity", {
        category: "invoice_sent",
        invoice_id: invoice.id,
        client_id: invoice.client_id,
        trigger: "Demo seed",
        observed_condition: null,
        reasoning: "Demo fixture: represents an invoice that was already issued before COLLECTIQ was connected.",
        proposed_action: `Invoice ${number} issued`,
        permission_result: "not_applicable",
        approval_status: "not_required",
        execution_status: "info",
        paypal_ref: invoice.paypal_invoice_id,
        error: null,
        mode: "demo",
        metadata: { demo: true },
        created_at: invoice.sent_at ?? undefined,
      } as never);
    }
    if (paid > 0) {
      await db.insert("agent_activity", {
        category: "payment_received",
        invoice_id: invoice.id,
        client_id: invoice.client_id,
        trigger: "Demo seed",
        observed_condition: `Demo fixture recorded ${paid / 100} USD paid`,
        reasoning: null,
        proposed_action: null,
        permission_result: "not_applicable",
        approval_status: "not_required",
        execution_status: "info",
        paypal_ref: invoice.paypal_invoice_id,
        error: null,
        mode: "demo",
        metadata: { demo: true },
        created_at: `${addDays(today, inv.paidOffset ?? 0)}T12:00:00.000Z`,
      } as never);
    }
  }
  return { created: true };
}

function demoPayPalStatus(s: InvoiceStatus): string {
  switch (s) {
    case "paid":
      return "PAID";
    case "partially_paid":
      return "PARTIALLY_PAID";
    case "cancelled":
      return "CANCELLED";
    default:
      return "SENT";
  }
}
