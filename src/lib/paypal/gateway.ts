import { fromCents } from "@/lib/money";
import type { Invoice, PayPalMode } from "@/lib/types";
import { PayPalClient, PayPalApiError } from "./client";
import type { CreateInvoicePayload, PayPalInvoice, PayPalInvoiceStatus } from "./types";

/**
 * The operations the collection engine needs from PayPal. Two implementations:
 *  - LivePayPalGateway: real PayPal REST calls (sandbox or live base URL)
 *  - DemoPayPalGateway: explicitly labelled simulation. It never contacts
 *    PayPal, every reference it returns starts with "DEMO-", and activity rows
 *    record mode = "demo".
 */
export interface PayPalGateway {
  readonly mode: PayPalMode;
  create(payload: CreateInvoicePayload, requestId: string): Promise<{ id: string; invoice: PayPalInvoice | null }>;
  send(id: string, opts: { subject?: string; note?: string }, requestId: string): Promise<{ recipientUrl: string | null }>;
  remind(id: string, opts: { subject?: string; note?: string }, requestId: string): Promise<void>;
  cancel(id: string, opts: { subject?: string; note?: string }, requestId: string): Promise<void>;
  /** Latest canonical state for an invoice that has already been created at PayPal. */
  fetch(local: Invoice): Promise<PayPalInvoice>;
}

export class LivePayPalGateway implements PayPalGateway {
  constructor(public readonly client: PayPalClient, public readonly mode: "sandbox" | "live") {}
  create(payload: CreateInvoicePayload, requestId: string) {
    return this.client.createDraftInvoice(payload, requestId);
  }
  send(id: string, opts: { subject?: string; note?: string }, requestId: string) {
    return this.client.sendInvoice(id, opts, requestId);
  }
  remind(id: string, opts: { subject?: string; note?: string }, requestId: string) {
    return this.client.remindInvoice(id, opts, requestId);
  }
  cancel(id: string, opts: { subject?: string; note?: string }, requestId: string) {
    return this.client.cancelInvoice(id, opts, requestId);
  }
  fetch(local: Invoice) {
    if (!local.paypal_invoice_id) {
      throw new PayPalApiError("Invoice has no PayPal invoice id yet", 400, null, "NOT_CREATED", null);
    }
    return this.client.getInvoice(local.paypal_invoice_id);
  }
}

const LOCAL_TO_PP: Record<string, PayPalInvoiceStatus> = {
  draft: "DRAFT",
  sent: "SENT",
  unpaid: "UNPAID",
  overdue: "SENT",
  partially_paid: "PARTIALLY_PAID",
  paid: "PAID",
  cancelled: "CANCELLED",
  refunded: "REFUNDED",
};

export class DemoPayPalGateway implements PayPalGateway {
  readonly mode = "demo" as const;
  /** Optional failure injection for tests. */
  constructor(private readonly opts: { failOn?: Array<"create" | "send" | "remind" | "cancel" | "fetch"> } = {}) {}

  private maybeFail(op: "create" | "send" | "remind" | "cancel" | "fetch") {
    if (this.opts.failOn?.includes(op)) {
      throw new PayPalApiError(`Demo gateway: injected ${op} failure`, 503, null, "DEMO_FAILURE", null);
    }
  }
  async create(payload: CreateInvoicePayload) {
    this.maybeFail("create");
    return { id: `DEMO-INV-${payload.detail.invoice_number}`, invoice: null };
  }
  async send() {
    this.maybeFail("send");
    return { recipientUrl: null };
  }
  async remind() {
    this.maybeFail("remind");
  }
  async cancel() {
    this.maybeFail("cancel");
  }
  /** In demo mode the local record is the only source of truth. */
  async fetch(local: Invoice): Promise<PayPalInvoice> {
    this.maybeFail("fetch");
    return {
      id: local.paypal_invoice_id ?? `DEMO-INV-${local.invoice_number}`,
      status: LOCAL_TO_PP[local.status] ?? "SENT",
      detail: { currency_code: local.currency, invoice_number: local.invoice_number },
      amount: { currency_code: local.currency, value: fromCents(local.total_cents) },
      due_amount: { currency_code: local.currency, value: fromCents(local.amount_due_cents) },
      payments: { paid_amount: { currency_code: local.currency, value: fromCents(local.amount_paid_cents) } },
    };
  }
}
