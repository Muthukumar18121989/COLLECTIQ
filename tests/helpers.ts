import { DEFAULT_POLICY } from "@/lib/agent/default-policy";
import { MemoryStore } from "@/lib/db/memory-store";
import { UserDb } from "@/lib/db/user-db";
import { addDays } from "@/lib/dates";
import { fromCents } from "@/lib/money";
import { PayPalApiError } from "@/lib/paypal/client";
import type { PayPalGateway } from "@/lib/paypal/gateway";
import type { GatewayResolver } from "@/lib/paypal";
import type { CreateInvoicePayload, PayPalInvoice, PayPalInvoiceStatus } from "@/lib/paypal/types";
import type { ServiceContext } from "@/lib/services/context";
import { createInvoiceDraft, sendInvoice } from "@/lib/services/invoices";
import type { AutonomyMode, Invoice } from "@/lib/types";

export const NOW = new Date("2026-11-09T12:00:00Z");
export const TODAY = "2026-11-09";

/** A fake PayPal that behaves like the sandbox: it keeps remote invoice state and records calls. */
export class FakePayPal implements PayPalGateway {
  readonly mode = "sandbox" as const;
  calls: Array<{ op: string; id?: string; requestId?: string }> = [];
  remote = new Map<string, { status: PayPalInvoiceStatus; total: number; paid: number; currency: string; number: string }>();
  fail = new Set<string>();
  private seq = 0;
  private byRequestId = new Map<string, string>();

  private check(op: string) {
    if (this.fail.has(op)) throw new PayPalApiError(`PayPal 500: injected ${op} failure`, 500, "debug-123", "INTERNAL_SERVER_ERROR", null);
  }
  async create(payload: CreateInvoicePayload, requestId: string) {
    this.calls.push({ op: "create", requestId });
    this.check("create");
    const existing = this.byRequestId.get(requestId);
    if (existing) return { id: existing, invoice: null };
    const id = `INV2-TEST-${++this.seq}`;
    const total = payload.items.reduce((s, it) => s + Math.round(Number(it.quantity) * Number(it.unit_amount.value) * 100), 0);
    this.remote.set(id, { status: "DRAFT", total, paid: 0, currency: payload.detail.currency_code, number: payload.detail.invoice_number });
    this.byRequestId.set(requestId, id);
    return { id, invoice: null };
  }
  async send(id: string, _o: unknown, requestId: string) {
    this.calls.push({ op: "send", id, requestId });
    this.check("send");
    this.remote.get(id)!.status = "SENT";
    return { recipientUrl: `https://www.sandbox.paypal.com/invoice/p/#${id}` };
  }
  async remind(id: string, _o: unknown, requestId: string) {
    this.calls.push({ op: "remind", id, requestId });
    this.check("remind");
  }
  async cancel(id: string, _o: unknown, requestId: string) {
    this.calls.push({ op: "cancel", id, requestId });
    this.check("cancel");
    this.remote.get(id)!.status = "CANCELLED";
  }
  async fetch(local: Invoice): Promise<PayPalInvoice> {
    this.calls.push({ op: "fetch", id: local.paypal_invoice_id ?? undefined });
    this.check("fetch");
    const r = this.remote.get(local.paypal_invoice_id!);
    if (!r) throw new PayPalApiError("PayPal 404: not found", 404, null, "RESOURCE_NOT_FOUND", null);
    return {
      id: local.paypal_invoice_id!,
      status: r.status,
      detail: { currency_code: r.currency, invoice_number: r.number, metadata: { recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${local.paypal_invoice_id}` } },
      amount: { currency_code: r.currency, value: fromCents(r.total) },
      due_amount: { currency_code: r.currency, value: fromCents(r.total - r.paid) },
      payments: { paid_amount: { currency_code: r.currency, value: fromCents(r.paid) } },
    };
  }
  /** Simulate the client paying at PayPal. */
  pay(id: string, cents: number) {
    const r = this.remote.get(id)!;
    r.paid += cents;
    r.status = r.paid >= r.total ? "PAID" : "PARTIALLY_PAID";
  }
  count(op: string) {
    return this.calls.filter((c) => c.op === op).length;
  }
}

export async function makeCtx(opts: { autonomy?: AutonomyMode; paypal?: FakePayPal; now?: Date; userId?: string } = {}) {
  const store = new MemoryStore(null);
  const userId = opts.userId ?? "11111111-1111-4111-8111-111111111111";
  const db = new UserDb(store, userId);
  await store.insert("profiles", {
    id: userId,
    email: "freelancer@example.com",
    full_name: "Test Freelancer",
    business_name: null,
    default_currency: "USD",
    autonomy_mode: opts.autonomy ?? "policy_driven",
    tax_rate_percent: 0,
    timezone: "UTC",
    agent_paused: false,
  });
  const policy = await db.insert("collection_policies", { ...DEFAULT_POLICY, is_demo: false });
  const paypal = opts.paypal ?? new FakePayPal();
  const gateways: GatewayResolver = { forInvoice: () => paypal };
  let now = opts.now ?? NOW;
  const ctx: ServiceContext = { db, gateways, now: () => now };
  const client = await db.insert("clients", {
    name: "Sarah Chen",
    email: "sarah@example.com",
    company: "Bloom Studio",
    phone: null,
    currency: "USD",
    collection_paused: false,
    dispute_open: false,
    dispute_note: null,
    notes: null,
    is_demo: false,
  });
  return {
    store,
    db,
    ctx,
    paypal,
    policy,
    client,
    setNow: (d: Date) => {
      now = d;
    },
  };
}

export async function sentInvoice(env: Awaited<ReturnType<typeof makeCtx>>, opts: { issue?: string; due?: string; amount?: number } = {}) {
  const draft = await createInvoiceDraft(env.ctx, {
    client_id: env.client.id,
    currency: "USD",
    issue_date: opts.issue ?? addDays(TODAY, -20),
    due_date: opts.due ?? addDays(TODAY, -1),
    items: [{ description: "Brand identity", quantity: 1, unit_amount: opts.amount ?? 850 }],
  });
  return sendInvoice(env.ctx, draft.id, { actor: "user" });
}

export const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
